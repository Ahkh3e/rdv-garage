import type { Unsubscribe } from "@rdv/core/events";
import type { Voice, VoiceJoin, VoiceStatus } from "@rdv/core/voice";
import { mulawDecode, mulawEncode, resample, rms } from "./mulaw";
import { Mixer, Playout } from "./playout";
import { createRelayClient, type RelayClient, type RelayTimers } from "./relayClient";
import { CODEC_MULAW_8K, encodeAudioFrame, FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE } from "./wire";

// What the phone provides: the audio session, a speaker queue and a microphone. The native module sits behind this.
export interface AudioEngine {
  requestPermission(): Promise<boolean>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  play(samples: Float32Array): void;
  startCapture(onSamples: (samples: Float32Array, sampleRate: number) => void): Promise<void>;
  stopCapture(): Promise<void>;
}

export interface RelayVoiceDeps {
  engine: AudioEngine;
  client?: RelayClient;
  timers?: RelayTimers & { every(fn: () => void, ms: number): unknown; stop(handle: unknown): void };
  now?: () => number;
}

const LEVEL_EMIT_MS = 150;
const LEVEL_GAIN = 4;

const defaultTimers = {
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  every: (fn: () => void, ms: number) => setInterval(fn, ms),
  stop: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
};

export function tokenIdentity(token: string): string | null {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

export function createRelayVoice(deps: RelayVoiceDeps): Voice {
  const engine = deps.engine;
  const timers = deps.timers ?? defaultTimers;
  const now = deps.now ?? Date.now;
  const client = deps.client ?? createRelayClient({ open: (url) => new WebSocket(url) as never });

  const mixer = new Mixer(FRAME_SAMPLES);
  const playout = new Playout(mixer);
  const peers = new Map<number, string>();
  const talking = new Set<number>();
  const heard = new Map<number, { level: number; at: number }>();
  let mine: string | null = null;
  let myIndex = -1;
  let myLevel = { level: 0, at: 0 };
  let soundMuted = false;
  let micOpen = false;
  let capturing = false;
  let epoch = 0;
  let seq = 0;
  let pending = new Float32Array(0);
  let pump: unknown = null;
  let lastLevels = 0;

  const status = new Set<(s: VoiceStatus) => void>();
  const speakers = new Set<(i: string[]) => void>();
  const participants = new Set<(i: string[]) => void>();
  const levels = new Set<(l: Record<string, number>) => void>();

  const emitStatus = (s: VoiceStatus) => status.forEach((fn) => fn(s));
  const emitSpeakers = () => {
    const ids = [...talking].map((i) => peers.get(i)).filter((id): id is string => !!id);
    speakers.forEach((fn) => fn(ids));
  };
  const emitParticipants = () => {
    const ids = [...peers.values()];
    participants.forEach((fn) => fn(ids));
  };
  const emitLevels = (t: number) => {
    if (t - lastLevels < LEVEL_EMIT_MS) return;
    lastLevels = t;
    const out: Record<string, number> = {};
    for (const [i, id] of peers) {
      const h = heard.get(i);
      out[id] = h && t - h.at < LEVEL_EMIT_MS * 2 ? h.level : 0;
    }
    if (mine) out[mine] = micOpen && t - myLevel.at < LEVEL_EMIT_MS * 2 ? myLevel.level : 0;
    levels.forEach((fn) => fn(out));
  };

  const resetRoom = () => {
    peers.clear();
    talking.clear();
    heard.clear();
    mixer.clear();
    myIndex = -1;
  };

  const tick = () => {
    const t = now();
    const silent = soundMuted || micOpen;
    for (const mixed of playout.tick(t)) {
      for (const [sender, level] of mixed.levels) heard.set(sender, { level: Math.min(1, level * LEVEL_GAIN), at: t });
      if (!silent) engine.play(mixed.samples);
    }
    emitLevels(t);
  };

  client.onMessage((m) => {
    if (m.t === "hello") {
      resetRoom();
      myIndex = m.you;
      for (const p of m.peers) peers.set(p.i, p.id);
      emitParticipants();
      emitSpeakers();
    } else if (m.t === "join") {
      peers.set(m.i, m.id);
      emitParticipants();
    } else if (m.t === "leave") {
      peers.delete(m.i);
      talking.delete(m.i);
      mixer.remove(m.i);
      heard.delete(m.i);
      emitParticipants();
      emitSpeakers();
    } else if (m.t === "talk" && m.i !== myIndex) {
      if (m.on) talking.add(m.i);
      else {
        talking.delete(m.i);
        mixer.end(m.i);
      }
      emitSpeakers();
    }
  });
  client.onFrame((f) => {
    if (f.codec !== CODEC_MULAW_8K || f.sender === myIndex) return;
    mixer.push(f.sender, f.seq, mulawDecode(f.payload));
  });
  client.onStatus((s) => {
    if (s === "reconnecting") resetRoom();
    emitStatus(s);
  });
  client.onOpen(() => {
    if (micOpen) client.setTalk(true);
  });

  const onSamples = (samples: Float32Array, rate: number) => {
    if (!micOpen) return;
    const at = rate === SAMPLE_RATE ? samples : resample(samples, rate, SAMPLE_RATE);
    const joined = new Float32Array(pending.length + at.length);
    joined.set(pending);
    joined.set(at, pending.length);
    let offset = 0;
    while (joined.length - offset >= FRAME_SAMPLES) {
      const chunk = joined.subarray(offset, offset + FRAME_SAMPLES);
      myLevel = { level: Math.min(1, rms(chunk) * LEVEL_GAIN), at: now() };
      client.sendFrame(encodeAudioFrame(CODEC_MULAW_8K, seq, mulawEncode(chunk)));
      seq = (seq + 1) & 65535;
      offset += FRAME_SAMPLES;
    }
    pending = joined.slice(offset);
  };

  const stopCapture = async () => {
    if (!capturing) return;
    capturing = false;
    await engine.stopCapture().catch(() => undefined);
  };

  const closeMic = async () => {
    micOpen = false;
    pending = new Float32Array(0);
    client.setTalk(false);
    await stopCapture();
  };

  const stopAll = async () => {
    if (pump !== null) timers.stop(pump);
    pump = null;
    await closeMic();
    client.disconnect();
    resetRoom();
    mine = null;
    await engine.stopSession().catch(() => undefined);
  };

  return {
    async connect({ url, token }: VoiceJoin) {
      const my = ++epoch;
      await stopAll();
      if (my !== epoch) return;
      mine = tokenIdentity(token);
      emitStatus("connecting");
      try {
        await engine.startSession();
        if (my !== epoch) return await engine.stopSession().catch(() => undefined);
        await client.connect(url, token);
        if (my !== epoch) return;
      } catch (e) {
        if (my !== epoch) return;
        await stopAll();
        throw e;
      }
      emitStatus("connected");
      pump = timers.every(tick, FRAME_MS);
    },
    async disconnect() {
      epoch++;
      await stopAll();
    },
    // Opening starts the microphone and tells the relay; closing stops both, so nothing is captured between presses.
    async setMicOpen(open: boolean) {
      if (!open) return closeMic();
      if (!client.connected()) throw new Error("not connected");
      if (micOpen) return;
      micOpen = true;
      pending = new Float32Array(0);
      try {
        capturing = true;
        await engine.startCapture(onSamples);
      } catch (e) {
        capturing = false;
        micOpen = false;
        throw e;
      }
      if (!micOpen) return stopCapture();
      client.setTalk(true);
    },
    requestMicPermission: () => engine.requestPermission().catch(() => false),
    setSoundMuted(muted: boolean) {
      soundMuted = muted;
    },
    identity: () => mine,
    onStatus: (fn): Unsubscribe => (status.add(fn), () => status.delete(fn)),
    onSpeakers: (fn): Unsubscribe => (speakers.add(fn), () => speakers.delete(fn)),
    onParticipants: (fn): Unsubscribe => (participants.add(fn), () => participants.delete(fn)),
    onLevels: (fn): Unsubscribe => (levels.add(fn), () => levels.delete(fn)),
  };
}
