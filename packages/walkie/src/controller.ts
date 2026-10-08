import type { Backend } from "@rdv/core";
import { codeOf } from "@rdv/core/errors";
import { createStore, type Store } from "@rdv/core/store";
import type { Voice, VoiceStatus } from "@rdv/core/voice";
import { createTalkTimer } from "./talkTimer";

export type Phase = "idle" | "joining" | "listening" | "reconnecting" | "unavailable" | "removed" | "left";
export type MicPermission = "unknown" | "granted" | "denied";

export interface WalkieState {
  roomId: string | null;
  roomName: string;
  phase: Phase;
  canPublish: boolean;
  voiceOffCrews: string[];
  talking: boolean;
  limitReached: boolean;
  soundMuted: boolean;
  mic: MicPermission;
  // Everyone else in the voice room and everyone else being heard, as user ids. Both come from the audio service and
  // the server-issued roster, never from anything a member sends.
  present: string[];
  audible: string[];
  error: string | null;
}

export interface RoomIndicator {
  show(roomName: string): Promise<void>;
  hide(): Promise<void>;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface WalkieDeps {
  backend: Pick<Backend, "invoke">;
  voice: Voice;
  userId(): string | null;
  indicator: RoomIndicator;
  // Shows the plain explanation before the system microphone prompt. Resolves false when the person backs out.
  explainMic(): Promise<boolean>;
  now?(): number;
  timers?: Timers;
}

export interface WalkieController {
  state: Store<WalkieState>;
  levels: Store<Record<string, number>>;
  // Being in a room is being in its channel: the room screen acquires on mount and releases on unmount. The most recently
  // acquired room is the one joined, so opening another room leaves the first and going back returns to it.
  acquire(roomId: string, roomName: string): () => void;
  press(): Promise<void>;
  release(): Promise<void>;
  setSoundMuted(muted: boolean): void;
  // Leave the channel but stay in the room screen; rejoin() comes back.
  leaveChannel(): Promise<void>;
  // True when it rejoined, false when there was nothing to rejoin.
  rejoin(): boolean;
  // The room's membership changed: refresh the roster that maps audio participants to people.
  rosterChanged(): void;
  dispose(): void;
}

interface TokenResponse {
  token: string;
  url: string;
  can_publish: boolean;
  expires_in: number;
  voice_off_crews?: string[];
  identities?: Record<string, string>;
}

export const FATAL_CODES = new Set(["not_room_member", "room_closed", "room_not_found", "suspended", "unauthenticated"]);
const REJOIN_PHASES = new Set<Phase>(["left", "removed", "unavailable"]);
export const REFRESH_MARGIN_MS = 60_000;
export const RETRY_MS = [1_000, 3_000, 8_000, 15_000, 30_000];
export const BUSY_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
export const ROSTER_MIN_GAP_MS = 15_000;
export const WATCHDOG_MS = 30_000;
export const CLOSE_MS = 8_000;

const initial: WalkieState = {
  roomId: null, roomName: "", phase: "idle", canPublish: false, voiceOffCrews: [], talking: false, limitReached: false,
  soundMuted: false, mic: "unknown", present: [], audible: [], error: null,
};

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export function createWalkie(deps: WalkieDeps): WalkieController {
  const { voice, backend, indicator } = deps;
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? Date.now;
  const state = createStore<WalkieState>(initial);
  const levels = createStore<Record<string, number>>({});
  const holders: { key: number; roomId: string; name: string }[] = [];
  let seq = 0;
  let epoch = 0;
  let roster: Record<string, string> = {};
  let rawSpeakers: string[] = [];
  let rawParticipants: string[] = [];
  let rawLevels: Record<string, number> = {};
  let lastFetchAt = 0;
  const unknownSeen = new Set<string>();
  let rosterHandle: unknown = null;
  let refreshFailures = 0;
  let refreshHandle: unknown = null;
  let retryHandle: unknown = null;
  let watchdogHandle: unknown = null;
  const boundedHandles = new Map<unknown, () => void>();
  let disposed = false;
  let flight = 0;
  let connectedAt = 0;
  let lateStatus: VoiceStatus | null = null;
  let indicatorPending = false;
  let pendingDisconnect: Promise<void> = Promise.resolve();
  let ignoreDisconnect = false;
  let held = false;
  let opening: Promise<void> | null = null;
  const patch = (next: Partial<WalkieState>) => state.set((s) => ({ ...s, ...next }));
  const timer = createTalkTimer(() => void release(), undefined, { set: (fn, ms) => timers.set(fn, ms), clear: (h) => timers.clear(h) });

  const mapIdentities = (identities: string[]) => {
    const me = deps.userId();
    const out: string[] = [];
    let unknown = false;
    for (const identity of identities) {
      const owner = roster[identity];
      if (!owner) {
        if (!unknownSeen.has(identity)) unknown = true;
        unknownSeen.add(identity);
      }
      else if (owner !== me && !out.includes(owner)) out.push(owner);
    }
    if (unknown) rosterChanged();
    return out;
  };
  const showPeople = () => {
    patch({ present: mapIdentities(rawParticipants), audible: mapIdentities(rawSpeakers) });
  };
  const showLevels = () => {
    const next: Record<string, number> = {};
    for (const [identity, level] of Object.entries(rawLevels)) {
      const owner = roster[identity];
      if (owner) next[owner] = level;
    }
    levels.set(next);
  };

  voice.onLevels((byIdentity) => {
    rawLevels = byIdentity;
    showLevels();
  });
  voice.onSpeakers((identities) => {
    rawSpeakers = identities;
    showPeople();
  });
  voice.onParticipants((identities) => {
    rawParticipants = identities;
    showPeople();
  });
  voice.onStatus((status: VoiceStatus) => {
    const s = state.get();
    if (!s.roomId || ignoreDisconnect) return;
    if (flight === epoch) {
      if (connectedAt === epoch) lateStatus = status;
      return;
    }
    if (status === "connected" && s.phase === "reconnecting") {
      disarmWatchdog();
      patch({ phase: "listening" });
    } else if (status === "reconnecting" && s.phase === "listening") {
      patch({ phase: "reconnecting" });
      armWatchdog(s.roomId, epoch);
    } else if (status === "disconnected" && (s.phase === "listening" || s.phase === "reconnecting")) {
      void recover();
    }
  });

  const applyRoster = (t: TokenResponse) => {
    roster = { ...(t.identities ?? {}) };
    showPeople();
    showLevels();
  };

  const clearTimers = () => {
    for (const h of [refreshHandle, retryHandle, rosterHandle, watchdogHandle]) if (h !== null) timers.clear(h);
    refreshHandle = retryHandle = rosterHandle = watchdogHandle = null;
    for (const [h, release] of [...boundedHandles]) {
      timers.clear(h);
      release();
    }
    boundedHandles.clear();
  };

  // A call into a dead room can hang forever; nothing in the controller may wait on one longer than this.
  const bounded = (p: Promise<unknown>) =>
    new Promise<void>((resolve) => {
      p.catch(() => undefined);
      if (disposed) return resolve();
      let h: unknown = null;
      const done = () => {
        if (h !== null) timers.clear(h);
        boundedHandles.delete(h);
        resolve();
      };
      h = timers.set(done, CLOSE_MS);
      boundedHandles.set(h, done);
      p.then(done, done);
    });

  const disarmWatchdog = () => {
    if (watchdogHandle !== null) timers.clear(watchdogHandle);
    watchdogHandle = null;
  };
  // Joining or reconnecting that has not connected in time is abandoned and started again with a fresh token.
  const armWatchdog = (roomId: string, my: number) => {
    disarmWatchdog();
    watchdogHandle = timers.set(() => {
      watchdogHandle = null;
      if (my !== epoch || state.get().roomId !== roomId) return;
      void recover();
    }, WATCHDOG_MS);
  };

  const disconnectVoice = () => {
    pendingDisconnect = pendingDisconnect
      .then(async () => {
        ignoreDisconnect = true;
        try {
          await bounded(voice.disconnect());
        } finally {
          ignoreDisconnect = false;
        }
      })
      .catch(() => undefined);
  };

  const closeMic = async () => {
    held = false;
    timer.stop();
    if (!state.get().talking) return;
    patch({ talking: false });
    await bounded(voice.setMicOpen(false));
  };

  function teardown(phase: Phase, error: string | null = null) {
    const wasIn = state.get().roomId !== null;
    epoch++;
    indicatorPending = false;
    flight = 0;
    clearTimers();
    void closeMic();
    roster = {};
    rawSpeakers = [];
    rawParticipants = [];
    rawLevels = {};
    refreshFailures = 0;
    lastFetchAt = 0;
    unknownSeen.clear();
    if (wasIn) {
      disconnectVoice();
      void indicator.hide().catch(() => undefined);
    }
    levels.set({});
    const keepRoom = phase === "left" || phase === "removed" || phase === "unavailable";
    state.set((s) => ({
      ...initial,
      roomId: keepRoom ? s.roomId : null,
      roomName: keepRoom ? s.roomName : "",
      phase,
      error,
      soundMuted: s.soundMuted,
      mic: s.mic,
    }));
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => { retryHandle = timers.set(() => { retryHandle = null; resolve(); }, ms); });

  async function join(roomId: string, my: number, preset?: TokenResponse) {
    flight = my;
    lateStatus = null;
    let given = preset;
    let attempt = 0;
    let busy = 0;
    for (;;) {
      if (my !== epoch) return;
      armWatchdog(roomId, my);
      try {
        const t = given ?? (await fetchToken(roomId));
        given = undefined;
        if (my !== epoch) return;
        await pendingDisconnect;
        if (my !== epoch) return;
        await voice.connect({ url: t.url, token: t.token });
        if (my !== epoch) return;
        connectedAt = my;
        lateStatus = null;
        voice.setSoundMuted(state.get().soundMuted);
        applyRoster(t);
        disarmWatchdog();
        refreshFailures = 0;
        patch({ phase: "listening", canPublish: t.can_publish, voiceOffCrews: t.voice_off_crews ?? [], error: null });
        scheduleRefresh(roomId, my, t.expires_in * 1000 - REFRESH_MARGIN_MS);
        if (indicatorPending) {
          indicatorPending = false;
          void indicator.show(state.get().roomName).catch(() => undefined);
        }
        flight = 0;
        const late = lateStatus;
        lateStatus = null;
        if (late === "disconnected") void recover();
        else if (late === "reconnecting") {
          patch({ phase: "reconnecting" });
          armWatchdog(roomId, my);
        }
        return;
      } catch (e) {
        if (my !== epoch) return;
        disarmWatchdog();
        const code = codeOf(e);
        if (FATAL_CODES.has(code)) {
          teardown("removed", code);
          return;
        }
        patch({ phase: "unavailable", error: code });
        const wait = code === "rate_limited" ? BUSY_MS[Math.min(busy++, BUSY_MS.length - 1)]! : RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]!;
        await sleep(wait);
      }
    }
  }

  async function fetchToken(roomId: string) {
    lastFetchAt = now();
    return backend.invoke<TokenResponse>("walkie_token", { room_id: roomId });
  }

  function scheduleRefresh(roomId: string, my: number, ms: number) {
    if (refreshHandle !== null) timers.clear(refreshHandle);
    refreshHandle = timers.set(() => void refresh(roomId, my), Math.max(15_000, ms));
  }

  async function refresh(roomId: string, my: number) {
    if (my !== epoch) return;
    try {
      const t = await fetchToken(roomId);
      if (my !== epoch) return;
      refreshFailures = 0;
      const changed = t.can_publish !== state.get().canPublish;
      patch({ voiceOffCrews: t.voice_off_crews ?? [] });
      applyRoster(t);
      if (changed) {
        if (!t.can_publish) await closeMic();
        await recover(t);
        return;
      }
      scheduleRefresh(roomId, my, t.expires_in * 1000 - REFRESH_MARGIN_MS);
    } catch (e) {
      if (my !== epoch) return;
      const code = codeOf(e);
      if (FATAL_CODES.has(code)) teardown("removed", code);
      else scheduleRefresh(roomId, my, code === "rate_limited" ? BUSY_MS[Math.min(refreshFailures++, BUSY_MS.length - 1)]! : 15_000);
    }
  }

  // Joined people change without a token refresh (someone is added or leaves): fetch the roster again, not oftener than
  // the minimum gap.
  function rosterChanged() {
    const roomId = state.get().roomId;
    if (!roomId || state.get().phase !== "listening" || rosterHandle !== null) return;
    const wait = Math.max(0, lastFetchAt + ROSTER_MIN_GAP_MS - now());
    const my = epoch;
    rosterHandle = timers.set(() => {
      rosterHandle = null;
      void refresh(roomId, my);
    }, wait);
  }

  // The connection dropped, or the grants changed: close the microphone and join again, with the fresh token when the
  // caller already holds one.
  async function recover(fresh?: TokenResponse) {
    const roomId = state.get().roomId;
    if (!roomId) return;
    const my = ++epoch;
    flight = my;
    if (refreshHandle !== null) timers.clear(refreshHandle);
    await closeMic();
    patch({ phase: "reconnecting" });
    disconnectVoice();
    await join(roomId, my, fresh);
  }

  function begin(roomId: string, name: string) {
    teardown("idle");
    const my = epoch;
    state.set((s) => ({ ...s, roomId, roomName: name, phase: "joining" }));
    indicatorPending = true;
    void join(roomId, my);
  }

  function reconcile() {
    const want = holders.at(-1);
    const current = state.get().roomId;
    if (!want) {
      if (current) teardown("idle");
    } else if (want.roomId !== current) begin(want.roomId, want.name);
  }

  async function press() {
    const s = state.get();
    if (s.phase !== "listening" || !s.canPublish || s.talking || held) return;
    held = true;
    if (s.mic !== "granted") {
      if (s.mic === "unknown" && !(await deps.explainMic())) {
        held = false;
        return;
      }
      const granted = await voice.requestMicPermission().catch(() => false);
      patch({ mic: granted ? "granted" : "denied" });
      if (!granted) {
        held = false;
        return;
      }
    }
    if (!held) return;
    const my = epoch;
    patch({ limitReached: false });
    opening = voice.setMicOpen(true).then(
      () => {
        if (!held || my !== epoch) {
          held = false;
          void voice.setMicOpen(false).catch(() => undefined);
          return;
        }
        patch({ talking: true });
        timer.start();
      },
      () => {
        held = false;
        patch({ error: "walkie_unavailable" });
      },
    );
    await opening;
  }

  async function release() {
    const expired = timer.active() === false && state.get().talking;
    held = false;
    if (opening) await opening;
    opening = null;
    if (expired) patch({ limitReached: true });
    await closeMic();
  }

  return {
    state,
    levels,
    acquire(roomId, roomName) {
      const key = ++seq;
      holders.push({ key, roomId, name: roomName });
      reconcile();
      return () => {
        const at = holders.findIndex((h) => h.key === key);
        if (at >= 0) holders.splice(at, 1);
        reconcile();
      };
    },
    press,
    release,
    setSoundMuted(muted) {
      patch({ soundMuted: muted });
      voice.setSoundMuted(muted);
    },
    async leaveChannel() {
      if (!state.get().roomId) return;
      teardown("left");
    },
    rejoin() {
      const want = holders.at(-1);
      if (!want || !REJOIN_PHASES.has(state.get().phase)) return false;
      begin(want.roomId, want.name);
      return true;
    },
    rosterChanged,
    dispose() {
      holders.length = 0;
      disposed = true;
      teardown("idle");
    },
  };
}
