export const CODEC_MULAW_8K = 1;
export const SAMPLE_RATE = 8000;
export const FRAME_SAMPLES = 160;
export const FRAME_MS = 20;
export const MAX_FRAME_BYTES = 1200;

// Client to relay: [codec:1][seq:uint16 big endian][payload]. Relay to client: [sender index:1] then the same.
export function encodeAudioFrame(codec: number, seq: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(3 + payload.length);
  out[0] = codec;
  out[1] = (seq >> 8) & 255;
  out[2] = seq & 255;
  out.set(payload, 3);
  return out;
}

export interface AudioFrame {
  sender: number;
  codec: number;
  seq: number;
  payload: Uint8Array;
}

export function decodeAudioFrame(data: Uint8Array): AudioFrame | null {
  if (data.length < 5 || data.length > MAX_FRAME_BYTES + 1) return null;
  return { sender: data[0]!, codec: data[1]!, seq: (data[2]! << 8) | data[3]!, payload: data.subarray(4) };
}

export type ServerMessage =
  | { t: "hello"; you: number; peers: { i: number; id: string }[] }
  | { t: "join"; i: number; id: string }
  | { t: "leave"; i: number }
  | { t: "talk"; i: number; on: boolean }
  | { t: "kicked" }
  | { t: "pong" };

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 256;

export function parseServerMessage(text: string): ServerMessage | null {
  let m: any;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  switch (m.t) {
    case "hello":
      if (!isIndex(m.you) || !Array.isArray(m.peers)) return null;
      return {
        t: "hello",
        you: m.you,
        peers: m.peers.filter((p: any) => p && isIndex(p.i) && typeof p.id === "string").map((p: any) => ({ i: p.i, id: p.id })),
      };
    case "join":
      return isIndex(m.i) && typeof m.id === "string" ? { t: "join", i: m.i, id: m.id } : null;
    case "leave":
      return isIndex(m.i) ? { t: "leave", i: m.i } : null;
    case "talk":
      return isIndex(m.i) && typeof m.on === "boolean" ? { t: "talk", i: m.i, on: m.on } : null;
    case "kicked":
      return { t: "kicked" };
    case "pong":
      return { t: "pong" };
    default:
      return null;
  }
}

export const talkMessage = (on: boolean) => JSON.stringify({ t: "talk", on });
export const PING_MESSAGE = '{"t":"ping"}';

// The sequence number wraps at 65536; positive means a is after b.
export function seqDiff(a: number, b: number): number {
  return ((a - b + 32768) & 65535) - 32768;
}
