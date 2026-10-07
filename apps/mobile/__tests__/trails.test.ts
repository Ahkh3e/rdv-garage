import { MAX_GAP_M, MAX_POINTS, MIN_STEP_M, TRAIL_MS, appendTrail, trailFeatures, type TrailPoint } from "../../../packages/map/src/trails";

const start = { lng: -79.38, lat: 43.65 };
const metresNorth = (m: number) => ({ lng: start.lng, lat: start.lat + m / 111320 });
const at = (m: number, ts: number): TrailPoint => ({ ...metresNorth(m), ts });

describe("movement trails", () => {
  it("starts a trail with the first point", () => {
    expect(appendTrail([], at(0, 0), 0)).toHaveLength(1);
  });

  it("ignores jitter smaller than the minimum step", () => {
    const trail = appendTrail([], at(0, 0), 0);
    expect(appendTrail(trail, at(MIN_STEP_M - 2, 3000), 3000)).toHaveLength(1);
    expect(appendTrail(trail, at(MIN_STEP_M + 2, 3000), 3000)).toHaveLength(2);
  });

  it("starts a fresh trail after a long gap in time", () => {
    const trail = appendTrail(appendTrail([], at(0, 0), 0), at(40, 3000), 3000);
    const next = appendTrail(trail, at(80, 3000 + 61_000), 3000 + 61_000);
    expect(next).toHaveLength(1);
  });

  it("starts a fresh trail after a jump in distance instead of drawing a long line", () => {
    const trail = appendTrail([], at(0, 0), 0);
    expect(appendTrail(trail, at(MAX_GAP_M + 100, 3000), 3000)).toHaveLength(1);
  });

  it("drops points older than the trail window and caps the length", () => {
    let trail: TrailPoint[] = [];
    for (let i = 0; i < MAX_POINTS + 40; i++) trail = appendTrail(trail, at(i * 20, i * 1000), i * 1000);
    expect(trail.length).toBeLessThanOrEqual(MAX_POINTS);
    const later = appendTrail(trail, at(20_000, 1_000_000 + TRAIL_MS), 1_000_000 + TRAIL_MS);
    expect(later).toHaveLength(1);
  });

  it("builds one fading segment per pair of points", () => {
    const now = 100_000;
    const points = [at(0, now - 60_000), at(30, now - 30_000), at(60, now)];
    const fc = trailFeatures({ a: { color: "#fff", points } }, now);
    expect(fc.features).toHaveLength(2);
    const [older, newer] = fc.features.map((f) => (f.properties as { a: number }).a);
    expect(newer!).toBeGreaterThan(older!);
  });
});
