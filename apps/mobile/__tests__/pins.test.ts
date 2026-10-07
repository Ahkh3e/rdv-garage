import { pinFeatures } from "../../../packages/map/src/pins";

describe("pin features", () => {
  it("turns pins into points with the crew tint and the namespaced id", () => {
    const [feature] = pinFeatures([{ id: "rdvs:1", lat: 43.7, lng: -79.4, label: "Meet", kind: "rdv", colorKey: 1, onPress: () => undefined }]);
    expect(feature!.geometry.coordinates).toEqual([-79.4, 43.7]);
    expect(feature!.properties).toMatchObject({ id: "rdvs:1", label: "Meet", kind: "rdv", color: "#9FBF8A" });
  });

  it("carries the live flag for the RDV ring badge", () => {
    const pin = { id: "rdvs:1", lat: 1, lng: 2, label: "Meet", kind: "rdv", colorKey: 0, onPress: () => undefined };
    expect(pinFeatures([{ ...pin, live: true }])[0]!.properties).toMatchObject({ live: true });
    expect(pinFeatures([pin])[0]!.properties).toMatchObject({ live: false });
  });
});
