import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ignoreLogs = vi.fn();
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
});
