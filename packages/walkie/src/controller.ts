import type { Backend, ChannelLike } from "@rdv/core";
import { codeOf } from "@rdv/core/errors";
import { createStore, type Store } from "@rdv/core/store";
import type { Voice, VoiceStatus } from "@rdv/core/voice";
import { emptyPeople, reducePeople, type People } from "./people";
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
  people: People;
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
  backend: Pick<Backend, "invoke" | "channel">;
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
  rejoin(): void;
  dispose(): void;
}

interface TokenResponse {
  token: string;
  url: string;
  can_publish: boolean;
  expires_in: number;
  voice_off_crews?: string[];
}

export const FATAL_CODES = new Set(["not_room_member", "room_closed", "room_not_found", "suspended", "unauthenticated"]);
export const REFRESH_MARGIN_MS = 60_000;
export const RETRY_MS = [1_000, 3_000, 8_000, 15_000];
export const HEARTBEAT_MS = 30_000;

const initial: WalkieState = {
  roomId: null, roomName: "", phase: "idle", canPublish: false, voiceOffCrews: [], talking: false, limitReached: false,
  soundMuted: false, mic: "unknown", people: emptyPeople, audible: [], error: null,
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
  let channel: ChannelLike | null = null;
  let channelReady = false;
  let refreshHandle: unknown = null;
  let retryHandle: unknown = null;
  let tickHandle: unknown = null;
  let pendingDisconnect: Promise<void> = Promise.resolve();
  let ignoreDisconnect = false;
  let held = false;
  let opening: Promise<void> | null = null;
  const patch = (next: Partial<WalkieState>) => state.set((s) => ({ ...s, ...next }));
  const timer = createTalkTimer(() => void release(), undefined, { set: (fn, ms) => timers.set(fn, ms), clear: (h) => timers.clear(h) });

  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    const me = deps.userId();
    if (!channel || !channelReady || !me) return;
    channel.send(event, { user_id: me, identity: voice.identity(), ...extra }).catch(() => undefined);
  };

  const identityOwners = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const { speakers, present } = state.get().people;
    for (const map of [present, speakers]) for (const [userId, p] of Object.entries(map)) if (p.identity) out[p.identity] = userId;
    return out;
  };

  voice.onLevels((byIdentity) => {
    const owners = identityOwners();
    const next: Record<string, number> = {};
    const me = deps.userId();
    for (const [identity, level] of Object.entries(byIdentity)) {
      const owner = identity === voice.identity() ? me : owners[identity];
      if (owner) next[owner] = level;
    }
    levels.set(next);
  });
  voice.onSpeakers((identities) => {
    const owners = identityOwners();
    patch({ audible: identities.map((i) => owners[i]).filter((u): u is string => !!u) });
  });
  voice.onStatus((status: VoiceStatus) => {
    const s = state.get();
    if (!s.roomId || ignoreDisconnect) return;
    if (status === "connected" && s.phase === "reconnecting") patch({ phase: "listening" });
    else if (status === "reconnecting" && s.phase === "listening") patch({ phase: "reconnecting" });
    else if (status === "disconnected" && (s.phase === "listening" || s.phase === "reconnecting")) void recover();
  });

  const hearPeople = (type: "start" | "stop" | "join" | "here" | "leave") => (payload: unknown) => {
    const p = payload as { user_id?: unknown; identity?: unknown } | null;
    const userId = typeof p?.user_id === "string" ? p.user_id : null;
    if (!userId || userId === deps.userId()) return;
    const identity = typeof p?.identity === "string" ? p.identity : null;
    state.set((s) => ({ ...s, people: reducePeople(s.people, { type, userId, identity, at: now() }) }));
    if (type === "join") {
      emit("here");
      if (state.get().talking) emit("start");
    }
  };

  const openChannel = (roomId: string) => {
    const ch = backend.channel(`walkie:${roomId}`);
    channel = ch;
    channelReady = false;
    for (const type of ["start", "stop", "join", "here", "leave"] as const) ch.on(type, hearPeople(type));
    ch.subscribe((status) => {
      if (channel !== ch) return;
      channelReady = status === "SUBSCRIBED";
      if (channelReady) emit("join");
    });
    tickHandle = timers.set(function tick() {
      if (channel !== ch) return;
      state.set((s) => ({ ...s, people: reducePeople(s.people, { type: "expire", at: now() }) }));
      emit("here");
      tickHandle = timers.set(tick, HEARTBEAT_MS);
    }, HEARTBEAT_MS);
  };

  const clearTimers = () => {
    for (const h of [refreshHandle, retryHandle, tickHandle]) if (h !== null) timers.clear(h);
    refreshHandle = retryHandle = tickHandle = null;
  };

  const disconnectVoice = () => {
    pendingDisconnect = pendingDisconnect
      .then(async () => {
        ignoreDisconnect = true;
        try {
          await voice.disconnect();
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
    emit("stop");
    await voice.setMicOpen(false).catch(() => undefined);
  };

  function teardown(phase: Phase, error: string | null = null) {
    const wasIn = state.get().roomId !== null;
    epoch++;
    clearTimers();
    void closeMic();
    emit("leave");
    const ch = channel;
    channel = null;
    channelReady = false;
    if (ch) setTimeout(() => void ch.unsubscribe().catch(() => undefined), 0);
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

  async function join(roomId: string, my: number, first: boolean) {
    for (let attempt = 0; ; attempt++) {
      if (my !== epoch) return;
      try {
        const t = await backend.invoke<TokenResponse>("walkie_token", { room_id: roomId });
        if (my !== epoch) return;
        await pendingDisconnect;
        if (my !== epoch) return;
        await voice.connect({ url: t.url, token: t.token });
        if (my !== epoch) return;
        voice.setSoundMuted(state.get().soundMuted);
        patch({ phase: "listening", canPublish: t.can_publish, voiceOffCrews: t.voice_off_crews ?? [], error: null });
        scheduleRefresh(roomId, my, t.expires_in);
        if (first) void indicator.show(state.get().roomName).catch(() => undefined);
        emit("join");
        return;
      } catch (e) {
        if (my !== epoch) return;
        const code = codeOf(e);
        if (FATAL_CODES.has(code)) {
          teardown("removed", code);
          return;
        }
        patch({ phase: "unavailable", error: code });
        await sleep(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!);
      }
    }
  }

  function scheduleRefresh(roomId: string, my: number, expiresIn: number) {
    if (refreshHandle !== null) timers.clear(refreshHandle);
    refreshHandle = timers.set(() => void refresh(roomId, my), Math.max(15_000, expiresIn * 1000 - REFRESH_MARGIN_MS));
  }

  async function refresh(roomId: string, my: number) {
    if (my !== epoch) return;
    try {
      const t = await backend.invoke<TokenResponse>("walkie_token", { room_id: roomId });
      if (my !== epoch) return;
      const changed = t.can_publish !== state.get().canPublish;
      patch({ voiceOffCrews: t.voice_off_crews ?? [] });
      if (changed) {
        if (!t.can_publish) await closeMic();
        await recover();
        return;
      }
      scheduleRefresh(roomId, my, t.expires_in);
    } catch (e) {
      if (my !== epoch) return;
      if (FATAL_CODES.has(codeOf(e))) teardown("removed", codeOf(e));
      else scheduleRefresh(roomId, my, 0);
    }
  }

  // The connection dropped, or the grants changed: close the microphone and join again with a fresh token.
  async function recover() {
    const roomId = state.get().roomId;
    if (!roomId) return;
    const my = ++epoch;
    if (refreshHandle !== null) timers.clear(refreshHandle);
    await closeMic();
    patch({ phase: "reconnecting" });
    disconnectVoice();
    await join(roomId, my, false);
  }

  function begin(roomId: string, name: string) {
    teardown("idle");
    const my = epoch;
    state.set((s) => ({ ...s, roomId, roomName: name, phase: "joining" }));
    openChannel(roomId);
    void join(roomId, my, true);
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
        emit("start");
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
      if (!want || state.get().phase !== "left" && state.get().phase !== "removed" && state.get().phase !== "unavailable") return;
      begin(want.roomId, want.name);
    },
    dispose() {
      holders.length = 0;
      teardown("idle");
    },
  };
}
