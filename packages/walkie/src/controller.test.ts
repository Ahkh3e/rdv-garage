import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@rdv/core/errors";
import type { Voice, VoiceStatus } from "@rdv/core/voice";
import { createWalkie, RETRY_MS, type WalkieController, type WalkieDeps } from "./controller";

class FakeVoice implements Voice {
  calls: string[] = [];
  permission = true;
  mic = false;
  holdOpen: Promise<void> | null = null;
  me = "ident-me";
  statusFns = new Set<(s: VoiceStatus) => void>();
  speakerFns = new Set<(i: string[]) => void>();
  levelFns = new Set<(l: Record<string, number>) => void>();
  async connect(join: { url: string; token: string }) { this.calls.push(`connect:${join.token}`); }
  async disconnect() { this.calls.push("disconnect"); }
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
  onLevels(fn: (l: Record<string, number>) => void) { this.levelFns.add(fn); return () => this.levelFns.delete(fn); }
  status(s: VoiceStatus) { this.statusFns.forEach((f) => f(s)); }
}

class FakeChannel {
  handlers: Record<string, (p: unknown) => void> = {};
  sent: { event: string; payload: Record<string, unknown> }[] = [];
  closed = false;
  constructor(readonly name: string) {}
  on(event: string, fn: (p: unknown) => void) { this.handlers[event] = fn; }
  subscribe(cb?: (s: "SUBSCRIBED") => void) { cb?.("SUBSCRIBED"); }
  async send(event: string, payload: Record<string, unknown>) { this.sent.push({ event, payload }); }
  async track() {}
  async untrack() {}
  async unsubscribe() { this.closed = true; }
  events() { return this.sent.map((s) => s.event); }
}

type Reply = { token?: string; can_publish?: boolean; expires_in?: number; voice_off_crews?: string[] } | Error;

function harness(replies: Reply[] = []) {
  const voice = new FakeVoice();
  const channels: FakeChannel[] = [];
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
        return { token: `t${invocations.length}`, url: "wss://x", can_publish: true, expires_in: 300, ...next } as never;
      },
      channel(name: string) { const c = new FakeChannel(name); channels.push(c); return c as never; },
    },
  };
  const walkie = createWalkie(deps);
  return { walkie, voice, channels, invocations, indicator, setExplain: (v: boolean) => (explain = v) };
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
    expect(h.channels[0]!.name).toBe("walkie:r1");
    expect(h.indicator.shown).toEqual(["Night run"]);
    expect(h.voice.mic).toBe(false);
    release();
    await settle();
    expect(phase(h.walkie)).toBe("idle");
    expect(h.voice.calls.at(-1)).toBe("disconnect");
    expect(h.indicator.hidden).toBeGreaterThan(0);
    expect(h.channels[0]!.events()).toContain("leave");
    expect(h.channels[0]!.closed).toBe(true);
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
    expect(h.channels[0]!.closed).toBe(true);
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
  it("asks for the microphone on the first press, opens only while held, and sends start and stop", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    expect(h.voice.calls).not.toContain("permission");
    await h.walkie.press();
    expect(h.voice.calls.slice(-2)).toEqual(["permission", "mic-on"]);
    expect(h.walkie.state.get()).toMatchObject({ talking: true, mic: "granted" });
    expect(h.channels[0]!.sent.find((s) => s.event === "start")!.payload).toEqual({ user_id: "me", identity: "ident-me" });
    await h.walkie.release();
    expect(h.voice.mic).toBe(false);
    expect(h.walkie.state.get().talking).toBe(false);
    expect(h.channels[0]!.events().slice(-1)).toEqual(["stop"]);
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
    expect(h.channels[0]!.events().slice(-2)).toEqual(["stop", "leave"]);
  });
});

describe("hearing others", () => {
  it("shows who is talking from start and stop events and maps levels to them", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    const ch = h.channels[0]!;
    ch.handlers.start!({ user_id: "u1", identity: "ident-1" });
    ch.handlers.start!({ user_id: "u2", identity: "ident-2" });
    ch.handlers.start!({ user_id: "me", identity: "ident-me" });
    expect(Object.keys(h.walkie.state.get().people.speakers).sort()).toEqual(["u1", "u2"]);
    h.voice.levelFns.forEach((f) => f({ "ident-1": 0.5, "ident-2": 0.1, "ident-me": 0.7, unknown: 1 }));
    expect(h.walkie.levels.get()).toEqual({ u1: 0.5, u2: 0.1, me: 0.7 });
    h.voice.speakerFns.forEach((f) => f(["ident-2", "stranger"]));
    expect(h.walkie.state.get().audible).toEqual(["u2"]);
    ch.handlers.stop!({ user_id: "u1" });
    expect(Object.keys(h.walkie.state.get().people.speakers)).toEqual(["u2"]);
    ch.handlers.start!({ user_id: 5 });
    expect(Object.keys(h.walkie.state.get().people.speakers)).toEqual(["u2"]);
  });

  it("answers a join with its presence and repeats its start for a late joiner", async () => {
    const h = harness();
    h.walkie.acquire("r1", "Room");
    await settle();
    await h.walkie.press();
    const ch = h.channels[0]!;
    ch.sent.length = 0;
    ch.handlers.join!({ user_id: "u9", identity: "ident-9" });
    expect(ch.events()).toEqual(["here", "start"]);
    expect(Object.keys(h.walkie.state.get().people.present)).toEqual(["u9"]);
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
