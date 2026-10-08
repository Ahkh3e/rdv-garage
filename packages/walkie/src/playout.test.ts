import { describe, expect, it } from "vitest";
import { JitterBuffer, LEAD_MS, Mixer, Playout } from "./playout";

const N = 4;
const frame = (v: number) => new Float32Array(N).fill(v);

describe("jitter buffer", () => {
  it("waits for the target depth, then releases in order", () => {
    const b = new JitterBuffer(N, 3);
    b.push(0, frame(0.1));
    b.push(1, frame(0.2));
    expect(b.pop()).toBeNull();
    b.push(2, frame(0.3));
    expect(b.pop()![0]).toBeCloseTo(0.1);
    expect(b.pop()![0]).toBeCloseTo(0.2);
  });

  it("reorders, drops duplicates and late frames, and handles sequence wrap", () => {
    const b = new JitterBuffer(N, 3);
    b.push(65535, frame(1));
    b.push(1, frame(3));
    b.push(0, frame(2));
    b.push(0, frame(9));
    expect([b.pop()![0], b.pop()![0], b.pop()![0]]).toEqual([1, 2, 3]);
    b.push(0, frame(9));
    expect(b.size()).toBe(0);
  });

  it("covers a short gap with silence and stops at an underrun until it refills", () => {
    const b = new JitterBuffer(N, 2);
    b.push(0, frame(1));
    b.push(2, frame(3));
    expect(b.pop()![0]).toBe(1);
    expect(b.pop()![0]).toBe(0);
    expect(b.pop()![0]).toBe(3);
    expect(b.pop()).toBeNull();
    b.push(3, frame(4));
    expect(b.pop()).toBeNull();
    b.push(4, frame(5));
    expect(b.pop()![0]).toBe(4);
  });

  it("plays out what is left when the sender stops, and bounds its size", () => {
    const b = new JitterBuffer(N, 6, 3);
    b.push(0, frame(1));
    b.end();
    expect(b.pop()![0]).toBe(1);
    const c = new JitterBuffer(N, 6, 3);
    for (let i = 0; i < 6; i++) c.push(i, frame(i));
    expect(c.size()).toBe(3);
  });
});

describe("mixer", () => {
  it("sums simultaneous talkers, clamps, and reports a level per sender", () => {
    const m = new Mixer(N);
    for (let i = 0; i < 6; i++) {
      m.push(0, i, frame(0.4));
      m.push(1, i, frame(0.8));
    }
    const mixed = m.mixFrame()!;
    expect(mixed.samples[0]).toBe(1);
    expect(mixed.levels.get(0)).toBeCloseTo(0.4);
    expect(mixed.levels.get(1)).toBeCloseTo(0.8);
  });

  it("mixes one talker unchanged and returns nothing while empty", () => {
    const m = new Mixer(N);
    expect(m.mixFrame()).toBeNull();
    for (let i = 0; i < 6; i++) m.push(2, i, frame(0.25));
    expect(m.mixFrame()!.samples[0]).toBe(0.25);
  });
});

describe("playout", () => {
  it("keeps about the lead ahead of the clock and goes quiet when nothing arrives", () => {
    const mixer = new Mixer(N);
    const p = new Playout(mixer);
    for (let i = 0; i < 20; i++) mixer.push(0, i, frame(0.5));
    expect(p.tick(1000)).toHaveLength(Math.ceil(LEAD_MS / 20));
    expect(p.tick(1000)).toHaveLength(0);
    expect(p.tick(1040)).toHaveLength(2);
    const empty = new Playout(new Mixer(N));
    expect(empty.tick(5)).toEqual([]);
  });
});
