import { CAR_ICON_KEYS } from "../../../packages/core/src/carIcons";
import { CAR_SCALE, MIN_MODEL_ZOOM, carFeatures, carScale, metresPerPoint } from "../../../packages/map/src/car3d";

const at = { lng: -79.38, lat: 43.65 };

function bounds(f: GeoJSON.Feature) {
  const ring = (f.geometry as GeoJSON.Polygon).coordinates[0]!;
  const lngs = ring.map((p) => p[0]!);
  const lats = ring.map((p) => p[1]!);
  return { w: Math.min(...lngs), e: Math.max(...lngs), s: Math.min(...lats), n: Math.max(...lats) };
}

describe("3D cars", () => {
  it("builds closed polygons with heights for every model", () => {
    for (const icon of CAR_ICON_KEYS) {
      const features = carFeatures([{ id: "a", ...at, heading: 0, icon, color: "#7FA6C9" }]);
      expect(features.length).toBeGreaterThanOrEqual(7);
      for (const f of features) {
        const ring = (f.geometry as GeoJSON.Polygon).coordinates[0]!;
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        const p = f.properties as { base: number; top: number };
        expect(p.top).toBeGreaterThan(p.base);
      }
    }
  });

  it("points the nose where the heading says", () => {
    const north = carFeatures([{ id: "n", ...at, heading: 0, icon: "gt", color: "#7FA6C9" }])[0]!;
    const east = carFeatures([{ id: "e", ...at, heading: 90, icon: "gt", color: "#7FA6C9" }])[0]!;
    const bn = bounds(north);
    const be = bounds(east);
    expect(bn.n - bn.s).toBeGreaterThan((bn.e - bn.w) * 1.2);
    expect(be.e - be.w).toBeGreaterThan((be.n - be.s) * 0.9);
  });

  it("uses one fixed size whatever the zoom, so a pinch never rescales the models", () => {
    expect(carScale()).toBe(CAR_SCALE);
    expect(CAR_SCALE).toBeGreaterThan(1);
    expect(CAR_SCALE).toBeLessThan(6);
    expect(metresPerPoint(12, at.lat)).toBeGreaterThan(metresPerPoint(16, at.lat));
    expect(MIN_MODEL_ZOOM).toBeGreaterThan(14);
  });

  it("keeps a car centred on its position", () => {
    const f = carFeatures([{ id: "c", ...at, heading: 33, icon: "muscle", color: "#fff" }])[0]!;
    const b = bounds(f);
    expect((b.w + b.e) / 2).toBeCloseTo(at.lng, 4);
    expect((b.s + b.n) / 2).toBeCloseTo(at.lat, 4);
  });
});

describe("3D cars, quiet members", () => {
  it("dims a stale car through its colours", () => {
    const live = carFeatures([{ id: "l", ...at, heading: 0, icon: "gt", color: "#7FA6C9" }])[0]!;
    const quiet = carFeatures([{ id: "q", ...at, heading: 0, icon: "gt", color: "#7FA6C9", stale: true }])[0]!;
    expect((live.properties as { color: string }).color).toBe("#7FA6C9");
    expect((quiet.properties as { color: string }).color).not.toBe("#7FA6C9");
  });
});
