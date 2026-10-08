import { describe, expect, it } from "vitest";
import { decodeAudioFrame, encodeAudioFrame, parseServerMessage, seqDiff } from "./wire";

describe("audio frames", () => {
  it("lays out codec, big endian sequence and payload", () => {
    expect([...encodeAudioFrame(1, 0x0102, Uint8Array.of(9, 8))]).toEqual([1, 1, 2, 9, 8]);
    expect([...encodeAudioFrame(1, 65535, new Uint8Array())]).toEqual([1, 255, 255]);
  });

  it("reads the sender index first on frames from the relay", () => {
    const f = decodeAudioFrame(Uint8Array.of(3, 1, 0x12, 0x34, 5, 6, 7))!;
    expect(f).toMatchObject({ sender: 3, codec: 1, seq: 0x1234 });
    expect([...f.payload]).toEqual([5, 6, 7]);
    expect(decodeAudioFrame(Uint8Array.of(3, 1, 0))).toBeNull();
    expect(decodeAudioFrame(new Uint8Array(1300))).toBeNull();
  });

  it("compares wrapped sequence numbers", () => {
    expect(seqDiff(5, 3)).toBe(2);
    expect(seqDiff(3, 5)).toBe(-2);
    expect(seqDiff(1, 65535)).toBe(2);
    expect(seqDiff(65535, 1)).toBe(-2);
  });
});

describe("server messages", () => {
  it("parses each known message and rejects malformed ones", () => {
    expect(parseServerMessage('{"t":"hello","you":2,"peers":[{"i":0,"id":"aa"},{"bad":1}]}')).toEqual({ t: "hello", you: 2, peers: [{ i: 0, id: "aa" }] });
    expect(parseServerMessage('{"t":"join","i":1,"id":"bb"}')).toEqual({ t: "join", i: 1, id: "bb" });
    expect(parseServerMessage('{"t":"leave","i":1}')).toEqual({ t: "leave", i: 1 });
    expect(parseServerMessage('{"t":"talk","i":1,"on":true}')).toEqual({ t: "talk", i: 1, on: true });
    expect(parseServerMessage('{"t":"kicked"}')).toEqual({ t: "kicked" });
    expect(parseServerMessage('{"t":"talk","i":300,"on":true}')).toBeNull();
    expect(parseServerMessage('{"t":"talk","i":1}')).toBeNull();
    expect(parseServerMessage("nope")).toBeNull();
    expect(parseServerMessage('{"t":"other"}')).toBeNull();
  });
});
