import { RoadIndex, linesFromFeatures } from "../../../packages/map/src/roadSnap";
import { snapTrail, trailPath, type TrailPoint } from "../../../packages/map/src/trails";

const o = { lng: -79.38, lat: 43.65 };
const east = (m: number) => ({ lng: o.lng + m / (111320 * Math.cos((o.lat * Math.PI) / 180)), lat: o.lat });
const north = (m: number) => ({ lng: o.lng, lat: o.lat + m / 111320 });
const road = (...pts: { lng: number; lat: number }[]) => linesFromFeatures([{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } }]);

describe("road snapping", () => {
  it("puts a point on the nearest road", () => {
    const index = new RoadIndex(road(east(0), east(200)));
    const snap = index.snap({ lng: east(100).lng, lat: o.lat + 8 / 111320 })!;
    expect(snap.dist).toBeGreaterThan(6);
    expect(snap.lat).toBeCloseTo(o.lat, 6);
  });

  it("ignores points that are nowhere near a road", () => {
    const index = new RoadIndex(road(east(0), east(200)));
    expect(index.snap({ lng: east(100).lng, lat: o.lat + 80 / 111320 })).toBeNull();
  });

  it("prefers the road that runs the way the person is travelling", () => {
    const index = new RoadIndex([...road(east(-50), east(50)), ...road(north(-50), north(50))].map((l, i) => ({ ...l, id: i })));
    const nearBoth = { lng: o.lng + 4 / 80000, lat: o.lat + 4 / 111320 };
    expect(index.snap(nearBoth, 0)!.line).toBe(1);
    expect(index.snap(nearBoth, 90)!.line).toBe(0);
  });

  it("follows the bend of a road between two fixes", () => {
    const corner = road(east(0), east(100), { lng: east(100).lng, lat: north(100).lat });
    const index = new RoadIndex(corner);
    const a = index.snap(east(60))!;
    const b = index.snap({ lng: east(100).lng, lat: north(40).lat })!;
    const via = index.between(a, b)!;
    expect(via).toHaveLength(1);
    expect(via[0]!.lng).toBeCloseTo(east(100).lng, 6);
  });

  it("draws a matched trail along the road instead of across the corner", () => {
    const index = new RoadIndex(road(east(0), east(100), { lng: east(100).lng, lat: north(100).lat }));
    const points: TrailPoint[] = [
      { ...east(60), ts: 0 },
      { lng: east(100).lng + 3 / 80000, lat: north(30).lat, ts: 3000 },
    ];
    snapTrail(points, index);
    expect(points.every((p) => p.snap)).toBe(true);
    const path = trailPath(points);
    expect(path.length).toBe(3);
    expect(path[1]!.lng).toBeCloseTo(east(100).lng, 6);
  });
});
