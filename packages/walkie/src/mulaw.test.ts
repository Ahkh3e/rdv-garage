import { describe, expect, it } from "vitest";
import { mulawDecode, mulawEncode, resample, rms } from "./mulaw";

describe("mu-law", () => {
  it("matches the G.711 reference codes", () => {
    expect([...mulawEncode(Float32Array.of(0, 1, -1))]).toEqual([0xff, 0x80, 0x00]);
  });

  it("round trips within the codec's quantisation error", () => {
    const input = new Float32Array(400).map((_, i) => 0.8 * Math.sin(i / 7));
    const out = mulawDecode(mulawEncode(input));
    let worst = 0;
    for (let i = 0; i < input.length; i++) worst = Math.max(worst, Math.abs(out[i]! - input[i]!) / Math.max(0.02, Math.abs(input[i]!)));
    expect(worst).toBeLessThan(0.07);
  });

  it("clips out of range input and keeps silence silent", () => {
    expect(mulawDecode(mulawEncode(Float32Array.of(3)))[0]).toBeGreaterThan(0.95);
    expect(Math.abs(mulawDecode(mulawEncode(Float32Array.of(0)))[0]!)).toBeLessThan(0.001);
  });
});

describe("resample and rms", () => {
  it("changes the length by the rate ratio and keeps a ramp linear", () => {
    const ramp = new Float32Array(480).map((_, i) => i / 480);
    const down = resample(ramp, 48000, 8000);
    expect(down.length).toBe(80);
    expect(down[10]).toBeCloseTo(60 / 480, 2);
    expect(resample(ramp, 8000, 8000)).toBe(ramp);
  });

  it("measures level", () => {
    expect(rms(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5);
    expect(rms(new Float32Array())).toBe(0);
  });
});
