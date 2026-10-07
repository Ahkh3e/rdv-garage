import { MAX_GAP_M, MAX_POINTS, MIN_STEP_M, TRAIL_M, TRAIL_MS, appendTrail, smooth, trailFeatures, type TrailPoint } from "../../../packages/map/src/trails";

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

  it("keeps only the newest stretch of path, whatever the speed", () => {
    const run = (stepM: number) => {
      let trail: TrailPoint[] = [];
      for (let i = 0; i < 80; i++) trail = appendTrail(trail, at(i * stepM, i * 1000), i * 1000);
      return trail;
    };
    const slow = run(10);
    const fast = run(30);
    const length = (t: TrailPoint[]) => (t[t.length - 1]!.lat - t[0]!.lat) * 111320;
    expect(length(slow)).toBeLessThanOrEqual(TRAIL_M + 40);
    expect(length(fast)).toBeLessThanOrEqual(TRAIL_M + 40);
    expect(Math.abs(length(fast) - length(slow))).toBeLessThan(60);
  });

  it("clears a trail after the time window and caps the number of points", () => {
    let trail: TrailPoint[] = [];
    for (let i = 0; i < MAX_POINTS + 40; i++) trail = appendTrail(trail, at(i * MIN_STEP_M * 1.5, i * 1000), i * 1000);
    expect(trail.length).toBeLessThanOrEqual(MAX_POINTS);
    const later = appendTrail(trail, at(20_000, 1_000_000 + TRAIL_MS), 1_000_000 + TRAIL_MS);
    expect(later).toHaveLength(1);
  });

  it("draws smoothed segments and fades toward the old end", () => {
    const points = [at(0, 0), at(100, 1000), at(200, 2000)];
    const fc = trailFeatures({ a: { color: "#fff", points } });
    expect(fc.features.length).toBeGreaterThan(2);
    const strengths = fc.features.map((f) => (f.properties as { a: number }).a);
    expect(strengths[0]!).toBeGreaterThan(strengths[strengths.length - 1]!);
  });

  it("rounds a right-angle corner", () => {
    const corner: TrailPoint[] = [
      { lng: start.lng, lat: start.lat, ts: 0 },
      { lng: start.lng, lat: start.lat + 0.0005, ts: 1000 },
      { lng: start.lng + 0.0005, lat: start.lat + 0.0005, ts: 2000 },
    ];
    const out = smooth(corner);
    expect(out.length).toBeGreaterThan(corner.length);
    expect(out.some((p) => p.lng === start.lng && p.lat === start.lat + 0.0005)).toBe(false);
  });
});
