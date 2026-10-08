import { describe, expect, it } from "vitest";
import type { VoiceStatus } from "@rdv/core/voice";
import { createRelayClient } from "./relayClient";
import { createRelayVoice, tokenIdentity, type AudioEngine } from "./relayVoice";
import { mulawDecode } from "./mulaw";
import type { SocketLike } from "./relayClient";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const TOKEN = `${b64({ alg: "HS256" })}.${b64({ sub: "me-id", room: "r" })}.sig`;

class Sock implements SocketLike {
  binaryType = "";
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: any[] = [];
  send(d: any) { this.sent.push(d); }
  close() { this.readyState = 3; }
  say(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  audio(sender: number, seq: number, v: number) {
    const payload = new Uint8Array(160).fill(v);
    this.onmessage?.({ data: Uint8Array.of(sender, 1, seq >> 8, seq & 255, ...payload).buffer });
  }
}

function setup() {
  const sock = new Sock();
  const played: Float32Array[] = [];
  const log: string[] = [];
  let capture: ((s: Float32Array, rate: number) => void) | null = null;
  const engine: AudioEngine = {
    requestPermission: async () => true,
    startSession: async () => void log.push("session"),
    stopSession: async () => void log.push("end-session"),
    play: (s) => void played.push(s),
    startCapture: async (fn) => { capture = fn; log.push("capture"); },
    stopCapture: async () => void log.push("stop-capture"),
  };
  let tick: (() => void) | null = null;
  let clock = 1000;
  const client = createRelayClient({ open: () => { queueMicrotask(() => sock.say({ t: "hello", you: 1, peers: [{ i: 0, id: "ace-id" }] })); return sock; } });
  const voice = createRelayVoice({
    engine,
    client,
    now: () => clock,
    timers: { set: setTimeout, clear: clearTimeout as never, every: (fn) => ((tick = fn), 1), stop: () => void (tick = null) },
  });
  const statuses: VoiceStatus[] = [];
  const speakers: string[][] = [];
  const people: string[][] = [];
  const levels: Record<string, number>[] = [];
  voice.onStatus((s) => statuses.push(s));
  voice.onSpeakers((s) => speakers.push(s));
  voice.onParticipants((s) => people.push(s));
  voice.onLevels((l) => levels.push(l));
  const run = (ms: number) => { for (let t = 0; t < ms; t += 20) { clock += 20; tick?.(); } };
  return { voice, sock, played, log, statuses, speakers, people, levels, run, capture: (s: Float32Array, rate = 8000) => capture!(s, rate) };
}

describe("relay voice", () => {
  it("reads its identity from the token", () => {
    expect(tokenIdentity(TOKEN)).toBe("me-id");
    expect(tokenIdentity("junk")).toBeNull();
  });

  it("joins listening: session first, peers from hello, nothing captured", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    expect(t.statuses).toEqual(["connecting", "connected"]);
    expect(t.people.at(-1)).toEqual(["ace-id"]);
    expect(t.voice.identity()).toBe("me-id");
    expect(t.log).not.toContain("capture");
    t.sock.say({ t: "join", i: 2, id: "zed-id" });
    expect(t.people.at(-1)).toEqual(["ace-id", "zed-id"]);
    t.sock.say({ t: "leave", i: 0 });
    expect(t.people.at(-1)).toEqual(["zed-id"]);
  });

  it("takes who is talking only from the relay's talk events", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    t.sock.say({ t: "talk", i: 0, on: true });
    expect(t.speakers.at(-1)).toEqual(["ace-id"]);
    t.sock.say({ t: "talk", i: 0, on: false });
    expect(t.speakers.at(-1)).toEqual([]);
  });

  it("plays received audio through the jitter buffer and reports levels", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    t.sock.say({ t: "talk", i: 0, on: true });
    for (let i = 0; i < 6; i++) t.sock.audio(0, i, 0x90);
    t.run(200);
    expect(t.played.length).toBeGreaterThanOrEqual(6);
    expect(t.played[0]![0]).toBeCloseTo(mulawDecode(Uint8Array.of(0x90))[0]!);
    expect(t.levels.some((l) => (l["ace-id"] ?? 0) > 0)).toBe(true);
  });

  it("mixes two talkers and ignores frames claiming to be itself", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    t.sock.say({ t: "join", i: 2, id: "zed-id" });
    for (let i = 0; i < 6; i++) {
      t.sock.audio(0, i, 0x90);
      t.sock.audio(2, i, 0x90);
      t.sock.audio(1, i, 0x90);
    }
    t.run(40);
    expect(t.played[0]![0]).toBeCloseTo(2 * mulawDecode(Uint8Array.of(0x90))[0]!);
  });

  it("opens the microphone on Talk: starts capture, tells the relay, sends 20 ms mu-law frames, mutes playback", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    await t.voice.setMicOpen(true);
    expect(t.sock.sent[0]).toBe('{"t":"talk","on":true}');
    t.capture(new Float32Array(100).fill(0.5));
    expect(t.sock.sent).toHaveLength(1);
    t.capture(new Float32Array(100).fill(0.5));
    const frame = t.sock.sent[1] as Uint8Array;
    expect(frame).toHaveLength(163);
    expect([...frame.subarray(0, 3)]).toEqual([1, 0, 0]);
    t.capture(new Float32Array(960).fill(0.5), 48000);
    expect((t.sock.sent[2] as Uint8Array)[2]).toBe(1);
    for (let i = 0; i < 6; i++) t.sock.audio(0, i, 0x90);
    t.run(100);
    expect(t.played).toHaveLength(0);
    await t.voice.setMicOpen(false);
    expect(t.sock.sent.at(-1)).toBe('{"t":"talk","on":false}');
    expect(t.log).toContain("stop-capture");
    const before = t.sock.sent.length;
    t.capture(new Float32Array(400).fill(0.5));
    expect(t.sock.sent).toHaveLength(before);
    for (let i = 6; i < 12; i++) t.sock.audio(0, i, 0x90);
    t.run(100);
    expect(t.played.length).toBeGreaterThan(0);
  });

  it("keeps sound muted until unmuted", async () => {
    const t = setup();
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    t.voice.setSoundMuted(true);
    for (let i = 0; i < 6; i++) t.sock.audio(0, i, 0x90);
    t.run(100);
    expect(t.played).toHaveLength(0);
  });

  it("refuses to open the microphone when not connected and leaves nothing running after disconnect", async () => {
    const t = setup();
    await expect(t.voice.setMicOpen(true)).rejects.toThrow("not connected");
    await t.voice.connect({ url: "wss://r", token: TOKEN });
    await t.voice.setMicOpen(true);
    await t.voice.disconnect();
    expect(t.log.slice(-2)).toEqual(["stop-capture", "end-session"]);
    expect(t.voice.identity()).toBeNull();
  });

  it("a connect superseded by another or by disconnect resolves quietly", async () => {
    const t = setup();
    const first = t.voice.connect({ url: "wss://r", token: TOKEN });
    const second = t.voice.disconnect();
    await expect(first).resolves.toBeUndefined();
    await second;
    expect(t.statuses.at(-1)).not.toBe("connected");
  });
});
