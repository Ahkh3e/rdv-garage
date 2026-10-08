import { FRAME_MS, seqDiff } from "./wire";
import { rms } from "./mulaw";

export const JITTER_FRAMES = 6;
export const MAX_QUEUED_FRAMES = 25;
export const LEAD_MS = 60;
const MAX_CONCEALED = 3;

// Holds one sender's frames in sequence order and releases them once enough have arrived to ride out network jitter.
export class JitterBuffer {
  private queue: { seq: number; samples: Float32Array }[] = [];
  private last: number | null = null;
  private playing = false;
  private ending = false;

  constructor(private readonly frameSamples: number, private readonly target = JITTER_FRAMES, private readonly max = MAX_QUEUED_FRAMES) {}

  push(seq: number, samples: Float32Array) {
    this.ending = false;
    if (this.last !== null && seqDiff(seq, this.last) <= 0) return;
    let at = this.queue.length;
    while (at > 0 && seqDiff(this.queue[at - 1]!.seq, seq) > 0) at--;
    if (at > 0 && this.queue[at - 1]!.seq === seq) return;
    this.queue.splice(at, 0, { seq, samples });
    if (this.queue.length > this.max) this.queue.shift();
  }

  // After the sender stops, what is left plays out without waiting for a full buffer.
  end() {
    this.ending = true;
  }

  size() {
    return this.queue.length;
  }

  idle() {
    return this.queue.length === 0 && !this.playing;
  }

  pop(): Float32Array | null {
    if (!this.playing) {
      if (this.queue.length < this.target && !(this.ending && this.queue.length > 0)) return null;
      this.playing = true;
    }
    const next = this.queue[0];
    if (!next) {
      this.playing = false;
      this.last = null;
      return null;
    }
    if (this.last !== null) {
      const gap = seqDiff(next.seq, this.last) - 1;
      if (gap > 0 && gap <= MAX_CONCEALED) {
        this.last = (this.last + 1) & 65535;
        return new Float32Array(this.frameSamples);
      }
    }
    this.queue.shift();
    this.last = next.seq;
    return next.samples;
  }
}

export interface Mixed {
  samples: Float32Array;
  levels: Map<number, number>;
}

// Sums every sender that has a frame ready, so several talkers at once are all heard.
export class Mixer {
  private senders = new Map<number, JitterBuffer>();

  constructor(private readonly frameSamples: number) {}

  push(sender: number, seq: number, samples: Float32Array) {
    let buffer = this.senders.get(sender);
    if (!buffer) this.senders.set(sender, (buffer = new JitterBuffer(this.frameSamples)));
    buffer.push(seq, samples);
  }

  end(sender: number) {
    this.senders.get(sender)?.end();
  }

  remove(sender: number) {
    this.senders.delete(sender);
  }

  clear() {
    this.senders.clear();
  }

  mixFrame(): Mixed | null {
    let out: Float32Array | null = null;
    const levels = new Map<number, number>();
    for (const [sender, buffer] of this.senders) {
      const frame = buffer.pop();
      if (!frame) {
        if (buffer.idle()) this.senders.delete(sender);
        continue;
      }
      levels.set(sender, rms(frame));
      out ??= new Float32Array(this.frameSamples);
      for (let i = 0; i < out.length; i++) out[i] = out[i]! + (frame[i] ?? 0);
    }
    if (!out) return null;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
    return { samples: out, levels };
  }
}

// Called on a timer: hands back the mixed frames needed to keep the speaker about LEAD_MS ahead of the clock.
export class Playout {
  private horizon = 0;

  constructor(readonly mixer: Mixer) {}

  tick(nowMs: number): Mixed[] {
    if (this.horizon < nowMs) this.horizon = nowMs;
    const out: Mixed[] = [];
    while (this.horizon < nowMs + LEAD_MS) {
      const mixed = this.mixer.mixFrame();
      if (!mixed) break;
      out.push(mixed);
      this.horizon += FRAME_MS;
    }
    return out;
  }
}
