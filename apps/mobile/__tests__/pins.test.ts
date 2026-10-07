import { pinFeatures } from "../../../packages/map/src/pins";

describe("pin features", () => {
  it("turns pins into points with the crew tint and the namespaced id", () => {
    const [feature] = pinFeatures([{ id: "rdvs:1", lat: 43.7, lng: -79.4, label: "Meet", kind: "rdv", colorKey: 1, onPress: () => undefined }]);
    expect(feature!.geometry.coordinates).toEqual([-79.4, 43.7]);
    expect(feature!.properties).toMatchObject({ id: "rdvs:1", label: "Meet", kind: "rdv", color: "#9FBF8A" });
  });
});
