import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ignoreLogs = vi.fn();
(globalThis as any).__DEV__ = true;
vi.mock("react-native", () => ({ PermissionsAndroid: {}, Platform: { OS: "ios" }, LogBox: { ignoreLogs: (p: unknown) => ignoreLogs(p) } }));

import { createLiveKitVoice } from "./livekit";

function mocks() {
  const log: string[] = [];
  const gates: { connect: (() => void) | null; fail: ((e: Error) => void) | null } = { connect: null, fail: null };
  class Room {
    remoteParticipants = new Map();
    localParticipant = { identity: "me", audioLevel: 0 };
    on() { return this; }
    connect() {
      log.push("room-connect");
      return new Promise<void>((resolve, reject) => { gates.connect = resolve; gates.fail = reject; });
    }
    async disconnect() { log.push("room-disconnect"); }
  }
  const rn = {
    AndroidAudioTypePresets: { communication: "c" },
    AudioSession: {
      configureAudio: async () => void log.push("configure"),
      startAudioSession: async () => void log.push("start-audio"),
      stopAudioSession: async () => void log.push("stop-audio"),
    },
  };
  const lk = { Room, RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }), Track: { Source: { Microphone: "mic" } } };
  return { log, gates, rn, lk };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("livekit connect", () => {
  it("leaves nothing alive when disconnect lands while connect is in flight", async () => {
    const m = mocks();
    const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
    const levels = vi.fn();
    voice.onLevels(levels);
    const connecting = voice.connect({ url: "wss://x", token: "t" });
    await vi.advanceTimersByTimeAsync(0);
    expect(m.log).toContain("room-connect");
    await voice.disconnect();
    m.gates.connect!();
    await connecting;
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.log).toContain("room-disconnect");
    expect(m.log.at(-1)).toBe("stop-audio");
    expect(levels).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(voice.identity()).toBeNull();
  });

  it("is abandoned before the room opens when disconnect lands during audio setup", async () => {
    const m = mocks();
    const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
    const connecting = voice.connect({ url: "wss://x", token: "t" });
    await voice.disconnect();
    await connecting;
    expect(m.log).not.toContain("room-connect");
    expect(m.log.at(-1)).toBe("stop-audio");
  });

  it("ends the audio session when connect fails", async () => {
    const m = mocks();
    const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
    const connecting = voice.connect({ url: "wss://x", token: "t" });
    const outcome = expect(connecting).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(0);
    m.gates.fail!(new Error("boom"));
    await outcome;
    expect(m.log).toContain("room-disconnect");
    expect(m.log.at(-1)).toBe("stop-audio");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a normal connection polling until disconnect", async () => {
    const m = mocks();
    const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
    const levels = vi.fn();
    voice.onLevels(levels);
    const connecting = voice.connect({ url: "wss://x", token: "t" });
    await vi.advanceTimersByTimeAsync(0);
    m.gates.connect!();
    await connecting;
    await vi.advanceTimersByTimeAsync(400);
    expect(levels).toHaveBeenCalled();
    await voice.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("quiets expected livekit errors in development and keeps the rest", async () => {
    const original = console.error;
    const seen: unknown[][] = [];
    console.error = (...a: unknown[]) => void seen.push(a);
    try {
      const m = mocks();
      const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
      const connecting = voice.connect({ url: "wss://x", token: "t" });
      await vi.advanceTimersByTimeAsync(0);
      m.gates.connect!();
      await connecting;
      console.error("error reading from signal stream, WS closed unexpectedly with code 1001");
      console.error("ping timeout triggered");
      console.error("real failure");
      expect(seen).toEqual([["real failure"]]);
      expect(ignoreLogs).toHaveBeenCalled();
      await voice.disconnect();
    } finally {
      console.error = original;
    }
  });

  it("a superseded disconnect settling late does not stop the new session's audio", async () => {
    const m = mocks();
    let release!: () => void;
    const rooms: any[] = [];
    const Base = m.lk.Room;
    m.lk.Room = class extends Base {
      constructor() {
        super();
        rooms.push(this);
      }
      async disconnect() {
        if (rooms[0] === this) await new Promise<void>((r) => (release = r));
        m.log.push("room-disconnect");
      }
    };
    const voice = createLiveKitVoice({ rn: m.rn, lk: m.lk });
    const first = voice.connect({ url: "wss://x", token: "a" });
    await vi.advanceTimersByTimeAsync(0);
    m.gates.connect!();
    await first;
    const stale = voice.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    const second = voice.connect({ url: "wss://x", token: "b" });
    await vi.advanceTimersByTimeAsync(0);
    m.gates.connect!();
    await second;
    m.log.length = 0;
    release();
    await stale;
    expect(m.log).not.toContain("stop-audio");
    expect(voice.identity()).toBe("me");
    await voice.disconnect();
  });
});
