const BIAS = 0x84;
const CLIP = 32635;

function encodeSample(f: number): number {
  let s = Math.round(Math.max(-1, Math.min(1, f)) * 32767);
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const DECODE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const t = (((u & 0x0f) << 3) + BIAS) << ((u & 0x70) >> 4);
  DECODE[i] = ((u & 0x80 ? BIAS - t : t - BIAS) / 32768);
}

export function mulawEncode(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = encodeSample(samples[i]!);
  return out;
}

export function mulawDecode(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]!]!;
  return out;
}

// Linear resampling, enough for speech when the device cannot deliver the requested rate.
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const n = Math.max(1, Math.round((input.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.min(Math.floor(pos), input.length - 1);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0]! + (input[i1]! - input[i0]!) * (pos - i0);
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}
