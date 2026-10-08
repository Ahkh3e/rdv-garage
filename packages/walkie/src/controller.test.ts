import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusLine } from "./lines";
import { AppError } from "@rdv/core/errors";
import type { Voice, VoiceStatus } from "@rdv/core/voice";
import { BUSY_MS, CLOSE_MS, createWalkie, RETRY_MS, WATCHDOG_MS, type WalkieController, type WalkieDeps } from "./controller";

class FakeVoice implements Voice {
  calls: string[] = [];
  permission = true;
  mic = false;
  holdOpen: Promise<void> | null = null;
  me = "ident-me";
  statusFns = new Set<(s: VoiceStatus) => void>();
  speakerFns = new Set<(i: string[]) => void>();
  participantFns = new Set<(i: string[]) => void>();
  levelFns = new Set<(l: Record<string, number>) => void>();
  hangConnects = 0;
  hangDisconnect = false;
  async connect(join: { url: string; token: string }) {
    this.calls.push(`connect:${join.token}`);
    if (this.hangConnects > 0) {
      this.hangConnects--;
      await new Promise<void>(() => undefined);
    }
  }
  async disconnect() {
    this.calls.push("disconnect");
    if (this.hangDisconnect) await new Promise<void>(() => undefined);
  }
  async setMicOpen(open: boolean) {
    if (open && this.holdOpen) await this.holdOpen;
    this.mic = open;
    this.calls.push(open ? "mic-on" : "mic-off");
  }
  async requestMicPermission() { this.calls.push("permission"); return this.permission; }
  setSoundMuted(m: boolean) { this.calls.push(`muted:${m}`); }
  identity() { return this.me; }
  onStatus(fn: (s: VoiceStatus) => void) { this.statusFns.add(fn); return () => this.statusFns.delete(fn); }
  onSpeakers(fn: (i: string[]) => void) { this.speakerFns.add(fn); return () => this.speakerFns.delete(fn); }
  onParticipants(fn: (i: string[]) => void) { this.participantFns.add(fn); return () => this.participantFns.delete(fn); }
  onLevels(fn: (l: Record<string, number>) => void) { this.levelFns.add(fn); return () => this.levelFns.delete(fn); }
  status(s: VoiceStatus) { this.statusFns.forEach((f) => f(s)); }
}

type Reply = { token?: string; can_publish?: boolean; expires_in?: number; voice_off_crews?: string[]; identities?: Record<string, string> } | Error;

const ROSTER = { "ident-me": "me", "ident-1": "u1", "ident-2": "u2" };

function harness(replies: Reply[] = []) {
  const voice = new FakeVoice();
  const invocations: Record<string, unknown>[] = [];
  const queue = [...replies];
  const indicator = { shown: [] as string[], hidden: 0, async show(name: string) { this.shown.push(name); }, async hide() { this.hidden++; } };
  let explain = true;
  const deps: WalkieDeps = {
    voice,
    userId: () => "me",
    indicator,
    explainMic: async () => explain,
    backend: {
      async invoke(name: string, body?: Record<string, unknown>) {
        expect(name).toBe("walkie_token");
        invocations.push(body ?? {});
        const next = queue.shift() ?? {};
        if (next instanceof Error) throw next;
        return { token: `t${invocations.length}`, url: "wss://x", can_publish: true, expires_in: 300, identities: ROSTER, ...next } as never;
      },
    },
  };
  const walkie = createWalkie(deps);
  return { walkie, voice, invocations, indicator, setExplain: (v: boolean) => (explain = v) };
}

const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
const phase = (w: WalkieController) => w.state.get().phase;

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("joining", () => {
  it("joins on acquire, listening, and leaves on release", async () => {
    const h = harness();
    const release = h.walkie.acquire("r1", "Night run");
    await settle();
    expect(h.invocations).toEqual([{ room_id: "r1" }]);
    expect(h.voice.calls).toContain("connect:t1");
    expect(phase(h.walkie)).toBe("listening");
    expect(h.indicator.shown).toEqual(["Night run"]);
    expect(h.voice.mic).toBe(false);
    release();
    await settle();
    expect(phase(h.walkie)).toBe("idle");
    expect(h.voice.calls.at(-1)).toBe("disconnect");
    expect(h.indicator.hidden).toBeGreaterThan(0);
  });

  it("shares one channel between the components of one room", async () => {
    const h = harness();
    const a = h.walkie.acquire("r1", "Room");
    const b = h.walkie.acquire("r1", "Room");
    await settle();
    expect(h.invocations).toHaveLength(1);
    a();
    await settle();
    expect(phase(h.walkie)).toBe("listening");
    b();
    await settle();
    expect(phase(h.walkie)).toBe("idle");
  });

  it("is in one channel at a time and returns to the first room when the second closes", async () => {
    const h = harness();
    h.walkie.acquire("r1", "One");
    await settle();
    const second = h.walkie.acquire("r2", "Two");
    await settle();
    expect(h.walkie.state.get().roomId).toBe("r2");
    expect(h.invocations.map((i) => i.room_id)).toEqual(["r1", "r2"]);
    second();
    await settle();
    expect(h.walkie.state.get().roomId).toBe("r1");
    expect(h.invocations.map((i) => i.room_id)).toEqual(["r1", "r2", "r1"]);
    expect(phase(h.walkie)).toBe("listening");
  });

  it("retries with backoff when the service is unavailable", async () => {
    const h = harness([new AppError("walkie_unavailable"), {}]);
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(phase(h.walkie)).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.invocations).toHaveLength(2);
  });

  it("treats rate_limited as busy, backing off to a minute without hammering", async () => {
    const limited = () => new AppError("rate_limited");
    const h = harness([limited(), limited(), limited(), limited(), limited(), limited(), limited(), {}]);
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(h.walkie.state.get()).toMatchObject({ phase: "unavailable", error: "rate_limited" });
    expect(statusLine(h.walkie.state.get())!.text).toBe("Busy, try again shortly.");
    expect(h.invocations).toHaveLength(1);
    let waited = 0;
    for (let i = 1; i < BUSY_MS.length + 2; i++) {
      const wait = BUSY_MS[Math.min(i - 1, BUSY_MS.length - 1)]!;
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(h.invocations).toHaveLength(i);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.invocations).toHaveLength(i + 1);
      waited += wait;
    }
    expect(BUSY_MS.at(-1)).toBe(60_000);
    expect(waited).toBeGreaterThan(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(phase(h.walkie)).toBe("listening");
  });

  it("caps ordinary retry backoff", async () => {
    const down = () => new AppError("walkie_unavailable");
    const h = harness(Array.from({ length: 8 }, down));
    h.walkie.acquire("r1", "Room");
    await settle();
    for (const wait of [...RETRY_MS, RETRY_MS.at(-1)!, RETRY_MS.at(-1)!]) await vi.advanceTimersByTimeAsync(wait);
    expect(h.invocations).toHaveLength(8);
    expect(Math.max(...RETRY_MS)).toBeLessThanOrEqual(30_000);
  });

  it("stops and reports removal when the server refuses membership", async () => {
    const h = harness([new AppError("not_room_member")]);
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(phase(h.walkie)).toBe("removed");
    expect(h.walkie.state.get().error).toBe("not_room_member");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.invocations).toHaveLength(1);
  });

  it("leaves on request and rejoins on request", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.leaveChannel();
    await settle();
    expect(phase(h.walkie)).toBe("left");
    expect(h.walkie.state.get().roomId).toBe("r1");
    h.walkie.rejoin();
    await settle();
    expect(phase(h.walkie)).toBe("listening");
    expect(h.invocations).toHaveLength(2);
  });
});

describe("rejoin", () => {
  it("rejoins only from left, removed or unavailable, and says when it did nothing", async () => {
    const h = harness([{}, new AppError("walkie_unavailable"), {}]);
    expect(h.walkie.rejoin()).toBe(false);
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.rejoin()).toBe(false);
    expect(h.invocations).toHaveLength(1);
    await h.walkie.leaveChannel();
    expect(h.walkie.rejoin()).toBe(true);
    await settle();
    expect(phase(h.walkie)).toBe("unavailable");
    expect(h.walkie.rejoin()).toBe(true);
    await settle();
    expect(phase(h.walkie)).toBe("listening");
  });

  it("does nothing while joining or when no room screen holds the channel", async () => {
    const h = harness();
    const release = h.walkie.acquire("r1", "Room");
    expect(phase(h.walkie)).toBe("joining");
    expect(h.walkie.rejoin()).toBe(false);
    await settle();
    release();
    await settle();
    expect(h.walkie.rejoin()).toBe(false);
  });
});

describe("tokens and reconnects", () => {
  it("asks for a fresh token before the five minutes end", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await vi.advanceTimersByTimeAsync(239_000);
    expect(h.invocations).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.invocations).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(h.invocations).toHaveLength(3);
    expect(phase(h.walkie)).toBe("listening");
  });

  it("leaves the channel when the refresh says the person is no longer a member", async () => {
    const h = harness([{}, new AppError("not_room_member")]);
    h.walkie.acquire("r1", "Room");
    await settle();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(phase(h.walkie)).toBe("removed");
    expect(h.voice.calls.at(-1)).toBe("disconnect");
  });

  it("reconnects with a new token when the connection drops", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.voice.status("disconnected");
    await settle();
    expect(h.voice.calls.filter((c) => c.startsWith("connect:"))).toEqual(["connect:t1", "connect:t2"]);
    expect(phase(h.walkie)).toBe("listening");
  });

  it("reconnects with the freshly fetched token when the refresh changes the grant", async () => {
    const h = harness([{}, { can_publish: false, voice_off_crews: ["Night Run"] }]);
    h.walkie.acquire("r1", "Room");
    await settle();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(h.invocations).toHaveLength(2);
    expect(h.voice.calls.filter((c) => c.startsWith("connect:"))).toEqual(["connect:t1", "connect:t2"]);
    expect(h.walkie.state.get()).toMatchObject({ canPublish: false, voiceOffCrews: ["Night Run"], phase: "listening" });
  });

  it("follows the service's own reconnecting and connected states", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.voice.status("reconnecting");
    expect(phase(h.walkie)).toBe("reconnecting");
    h.voice.status("connected");
    expect(phase(h.walkie)).toBe("listening");
    expect(h.invocations).toHaveLength(1);
  });

  it("closes the microphone and reconnects listen-only when the grant is withdrawn", async () => {
    const h = harness([{}, { can_publish: false, voice_off_crews: ["Night Run"] }, { can_publish: false, voice_off_crews: ["Night Run"] }]);
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    expect(h.walkie.state.get().talking).toBe(true);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(h.walkie.state.get()).toMatchObject({ talking: false, canPublish: false, voiceOffCrews: ["Night Run"], phase: "listening" });
    expect(h.voice.mic).toBe(false);
  });
});

describe("talking", () => {
  it("asks for the microphone on the first press and opens only while held", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(h.voice.calls).not.toContain("permission");
    await h.walkie.press();
    expect(h.voice.calls.slice(-2)).toEqual(["permission", "mic-on"]);
    expect(h.walkie.state.get()).toMatchObject({ talking: true, mic: "granted" });
    await h.walkie.release();
    expect(h.voice.mic).toBe(false);
    expect(h.walkie.state.get().talking).toBe(false);
    await h.walkie.press();
    expect(h.voice.calls.filter((c) => c === "permission")).toHaveLength(1);
  });

  it("does not open the microphone when the person declines the explanation or the permission", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.setExplain(false);
    await h.walkie.press();
    expect(h.voice.calls).not.toContain("permission");
    expect(h.walkie.state.get().mic).toBe("unknown");
    h.setExplain(true);
    h.voice.permission = false;
    await h.walkie.press();
    expect(h.walkie.state.get()).toMatchObject({ talking: false, mic: "denied" });
    expect(h.voice.calls).not.toContain("mic-on");
  });

  it("closes by itself after sixty seconds", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.walkie.state.get().talking).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.walkie.state.get()).toMatchObject({ talking: false, limitReached: true });
    expect(h.voice.mic).toBe(false);
    await h.walkie.press();
    expect(h.walkie.state.get()).toMatchObject({ talking: true, limitReached: false });
  });

  it("closes the microphone if the button is released before it finished opening", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    await h.walkie.release();
    let open!: () => void;
    h.voice.holdOpen = new Promise<void>((r) => (open = r));
    const pressing = h.walkie.press();
    await settle();
    const releasing = h.walkie.release();
    open();
    await pressing;
    await releasing;
    expect(h.voice.mic).toBe(false);
    expect(h.walkie.state.get().talking).toBe(false);
  });

  it("does not let a voice-off member talk", async () => {
    const h = harness([{ can_publish: false, voice_off_crews: ["Night Run"] }]);
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    expect(h.voice.calls).not.toContain("mic-on");
    expect(h.walkie.state.get().voiceOffCrews).toEqual(["Night Run"]);
  });

  it("closes the microphone when leaving the channel while talking", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    await h.walkie.leaveChannel();
    await settle();
    expect(h.voice.mic).toBe(false);
  });
});

describe("hearing others", () => {
  it("maps the audio service's speakers and levels to people with the server roster", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.voice.levelFns.forEach((f) => f({ "ident-1": 0.5, "ident-2": 0.1, "ident-me": 0.7, unknown: 1 }));
    expect(h.walkie.levels.get()).toEqual({ u1: 0.5, u2: 0.1, me: 0.7 });
    h.voice.speakerFns.forEach((f) => f(["ident-2", "ident-me"]));
    expect(h.walkie.state.get().audible).toEqual(["u2"]);
    h.voice.participantFns.forEach((f) => f(["ident-1", "ident-2"]));
    expect(h.walkie.state.get().present).toEqual(["u1", "u2"]);
    h.voice.speakerFns.forEach((f) => f([]));
    expect(h.walkie.state.get().audible).toEqual([]);
  });

  it("is not changed by anything a member sends: only the audio service and the roster decide", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.voice.speakerFns.forEach((f) => f(["forged-identity"]));
    expect(h.walkie.state.get().audible).toEqual([]);
    h.voice.speakerFns.forEach((f) => f(["ident-1"]));
    expect(h.walkie.state.get().audible).toEqual(["u1"]);
  });

  it("refreshes the roster once for an unknown participant and learns a newcomer from it", async () => {
    const h = harness([{}, { identities: { ...ROSTER, "ident-9": "u9" } }]);
    h.walkie.acquire("r1", "Room");
    await settle();
    h.voice.speakerFns.forEach((f) => f(["ident-9"]));
    expect(h.walkie.state.get().audible).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.invocations).toHaveLength(2);
    expect(h.walkie.state.get().audible).toEqual(["u9"]);
    h.voice.speakerFns.forEach((f) => f(["ident-9", "ghost"]));
    h.voice.speakerFns.forEach((f) => f(["ghost"]));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.invocations).toHaveLength(3);
  });

  it("refreshes the roster on request, not oftener than the minimum gap", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.walkie.rosterChanged();
    h.walkie.rosterChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.invocations).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.invocations).toHaveLength(2);
  });

  it("applies the mute-room-sound setting to the service and keeps it across rooms", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    h.walkie.setSoundMuted(true);
    expect(h.voice.calls).toContain("muted:true");
    h.walkie.acquire("r2", "Other");
    await settle();
    expect(h.voice.calls.at(-1)).toBe("muted:true");
    expect(h.walkie.state.get().soundMuted).toBe(true);
  });
});

describe("stalled reconnects", () => {
  const listening = async (replies: Reply[] = []) => {
    const h = harness(replies);
    const release = h.walkie.acquire("r1", "Room");
    await settle();
    expect(phase(h.walkie)).toBe("listening");
    return { ...h, release };
  };

  it("rejoins listen-only at once when the service reports a disconnect after a kick", async () => {
    const h = await listening([{}, { can_publish: false, voice_off_crews: ["c1"] }]);
    h.voice.status("disconnected");
    await settle();
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get()).toMatchObject({ canPublish: false, voiceOffCrews: ["c1"] });
    expect(h.voice.calls.filter((c) => c.startsWith("connect:"))).toEqual(["connect:t1", "connect:t2"]);
  });

  it("restarts with a fresh token when the service keeps reconnecting and never reports back", async () => {
    const h = await listening([{}, { can_publish: false }]);
    h.voice.status("reconnecting");
    expect(phase(h.walkie)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1);
    expect(phase(h.walkie)).toBe("reconnecting");
    expect(h.invocations).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.invocations).toHaveLength(2);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get().canPublish).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not restart when the service reconnects in time", async () => {
    const h = await listening();
    h.voice.status("reconnecting");
    await vi.advanceTimersByTimeAsync(10_000);
    h.voice.status("connected");
    expect(phase(h.walkie)).toBe("listening");
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(h.invocations).toHaveLength(1);
  });

  it("abandons a connect that never finishes and joins again, without stacking attempts", async () => {
    const h = harness([{}, { can_publish: false }]);
    h.voice.hangConnects = 1;
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(phase(h.walkie)).toBe("joining");
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(h.invocations).toHaveLength(2);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get().canPublish).toBe(false);
    expect(h.voice.calls.filter((c) => c.startsWith("connect:"))).toHaveLength(2);
    expect(h.indicator.shown).toEqual(["Room"]);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 3);
    expect(h.invocations).toHaveLength(2);
  });

  it("recovers after a kick whose connect and disconnect both hang", async () => {
    const h = await listening([{}, { can_publish: false }, { can_publish: false }]);
    h.voice.hangDisconnect = true;
    h.voice.hangConnects = 1;
    h.voice.status("disconnected");
    await settle();
    expect(phase(h.walkie)).toBe("reconnecting");
    h.voice.hangDisconnect = false;
    await vi.advanceTimersByTimeAsync(CLOSE_MS + WATCHDOG_MS + 1_000);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get().canPublish).toBe(false);
  });

  it("is not held up by a microphone close that never returns", async () => {
    const h = await listening([{}, { can_publish: false }]);
    await h.walkie.press();
    expect(h.walkie.state.get().talking).toBe(true);
    h.voice.setMicOpen = () => new Promise<void>(() => undefined);
    h.voice.status("disconnected");
    await vi.advanceTimersByTimeAsync(CLOSE_MS + 1_000);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get().talking).toBe(false);
  });

  it("keeps the busy backoff when recovery is rate limited, then listens", async () => {
    const h = await listening([{}, new AppError("rate_limited"), { can_publish: false }]);
    h.voice.status("disconnected");
    await settle();
    expect(h.walkie.state.get()).toMatchObject({ phase: "unavailable", error: "rate_limited" });
    await vi.advanceTimersByTimeAsync(BUSY_MS[0]! - 1);
    expect(h.invocations).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(phase(h.walkie)).toBe("listening");
    expect(h.walkie.state.get().canPublish).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("settles as removed when recovery finds the person is out, with no timers left", async () => {
    const h = await listening([{}, new AppError("not_room_member")]);
    h.voice.status("disconnected");
    await settle();
    expect(phase(h.walkie)).toBe("removed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the watchdog on leave and on dispose", async () => {
    const h = harness();
    h.voice.hangConnects = 2;
    const release = h.walkie.acquire("r1", "Room");
    await settle();
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS * 2);
    expect(h.invocations).toHaveLength(1);
    h.walkie.acquire("r1", "Room");
    await settle();
    h.walkie.dispose();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    expect(phase(h.walkie)).toBe("idle");
  });
});
