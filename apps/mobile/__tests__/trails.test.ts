import { MAX_GAP_M, MAX_POINTS, MIN_STEP_M, TRAIL_M, TRAIL_MS, appendTrail, coreOf, neonOf, smooth, trailFeatures, type TrailPoint } from "../../../packages/map/src/trails";

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

describe("neon colours", () => {
  const lightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    return (Math.max(r!, g!, b!) + Math.min(r!, g!, b!)) / 2;
  };
  const saturation = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    const max = Math.max(r!, g!, b!);
    const min = Math.min(r!, g!, b!);
    return max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
  };

  it("makes a colour more saturated and lighter", () => {
    const neon = neonOf("#2F6FF2");
    expect(neon).toMatch(/^#[0-9A-F]{6}$/);
    expect(saturation(neon)).toBeGreaterThan(saturation("#2F6FF2"));
    expect(lightness(neon)).toBeGreaterThan(lightness("#2F6FF2"));
    expect(saturation(neon)).toBeCloseTo(1, 1);
  });

  it("keeps a neon colour on its hue and a white neutral", () => {
    expect(neonOf("#FF4FD8")).toMatch(/^#FF/);
    const white = neonOf("#F2F5FA");
    const n = parseInt(white.slice(1), 16);
    const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(30);
    expect(lightness(white)).toBeGreaterThanOrEqual(0.9);
  });

  it("makes the core lighter than the neon line", () => {
    expect(lightness(coreOf("#3D7BFF"))).toBeGreaterThan(lightness(neonOf("#3D7BFF")));
  });

  it("puts the neon and core colours and a bright head on the trail segments", () => {
    const points: TrailPoint[] = [at(0, 0), at(20, 1000), at(40, 2000)];
    const fc = trailFeatures({ a: { color: "#3D7BFF", points } });
    const first = fc.features[0]!.properties!;
    const last = fc.features.at(-1)!.properties!;
    expect(first.color).toBe(neonOf("#3D7BFF"));
    expect(first.core).toBe(coreOf("#3D7BFF"));
    expect(first.a).toBe(1);
    expect(last.a).toBeLessThan(first.a);
  });
});
