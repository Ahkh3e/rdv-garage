import { MAX_SAMPLES, addSample, positionAt, type Sample } from "../../../packages/map/src/interp";

const s = (t: number, lng: number, lat = 43.65, heading = 90): Sample => ({ t, lng, lat, heading });

describe("steady movement between updates", () => {
  it("moves at a constant speed between two updates", () => {
    const list = [s(0, -79.4), s(3000, -79.39)];
    const a = positionAt(list, 750)!.lng;
    const b = positionAt(list, 1500)!.lng;
    const c = positionAt(list, 2250)!.lng;
    expect(b - a).toBeCloseTo(c - b, 9);
    expect(b).toBeCloseTo(-79.395, 6);
  });

  it("holds at the newest position when no newer update has arrived", () => {
    const list = [s(0, -79.4), s(3000, -79.39)];
    expect(positionAt(list, 9000)!.lng).toBe(-79.39);
  });

  it("turns the short way round when the heading wraps past north", () => {
    const list = [s(0, -79.4, 43.65, 350), s(1000, -79.4, 43.65, 10)];
    expect(positionAt(list, 500)!.heading).toBeCloseTo(0, 5);
  });

  it("jumps instead of sliding after a long silence, and ignores repeats", () => {
    let list: Sample[] = [s(0, -79.4)];
    list = addSample(list, s(1000, -79.4));
    expect(list).toHaveLength(1);
    list = addSample(list, s(60000, -79.3));
    expect(list).toHaveLength(1);
    expect(list[0]!.lng).toBe(-79.3);
  });

  it("keeps a bounded history", () => {
    let list: Sample[] = [];
    for (let i = 0; i < MAX_SAMPLES + 8; i++) list = addSample(list, s(i * 1000, -79.4 + i * 0.001));
    expect(list).toHaveLength(MAX_SAMPLES);
  });
});
