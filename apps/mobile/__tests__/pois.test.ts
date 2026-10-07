import { poisFromFeatures } from "../../../packages/map/src/pois";
import { rdvNightStyle, POI_LAYER } from "../../../packages/map/src/style";

const feature = (props: Record<string, unknown>, coordinates: number[] = [-79.38, 43.65]) =>
  ({ type: "Feature", geometry: { type: "Point", coordinates }, properties: props }) as GeoJSON.Feature;

describe("poisFromFeatures", () => {
  it("reads name, class and position, preferring the English name", () => {
    expect(poisFromFeatures([feature({ name: "Essence", "name:en": "Gas", class: "fuel", subclass: "fuel" })])).toEqual([
      { name: "Gas", lat: 43.65, lng: -79.38, cls: "fuel", subclass: "fuel" },
    ]);
  });
  it("drops unnamed, non-point and duplicate features", () => {
    const line = { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { name: "x", class: "fuel" } } as GeoJSON.Feature;
    const twice = feature({ name: "Cafe", class: "cafe" });
    expect(poisFromFeatures([feature({ class: "fuel" }), line, twice, twice])).toHaveLength(1);
  });
});

describe("RDV Night poi layer", () => {
  it("draws the six nearby categories quietly", () => {
    const layer = rdvNightStyle.layers.find((l) => l.id === POI_LAYER) as { type: string; "source-layer": string; minzoom: number; paint: Record<string, unknown> };
    expect(layer.type).toBe("circle");
    expect(layer["source-layer"]).toBe("poi");
    expect(layer.minzoom).toBeGreaterThanOrEqual(12);
    expect(layer.paint["circle-opacity"]).toBeLessThanOrEqual(0.75);
  });
});
