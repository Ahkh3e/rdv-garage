import { PULSE_STEPS, PULSE_STILL, pinFeatures, pulsePhase, pulseStep } from "../../../packages/map/src/pins";

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

describe("pin pulse", () => {
  it("runs eight discrete steps over a two second cycle and repeats", () => {
    const steps = [0, 249, 250, 999, 1000, 1999, 2000, 2250].map(pulseStep);
    expect(steps).toEqual([0, 0, 1, 3, 4, 7, 0, 1]);
    expect(new Set(Array.from({ length: 2000 }, (_, ms) => pulseStep(ms))).size).toBe(PULSE_STEPS);
  });

  it("keeps the phase inside 0 to 1 and holds a static ring for reduced motion", () => {
    expect(pulsePhase(0)).toBe(0);
    expect(pulsePhase(PULSE_STEPS - 1)).toBeLessThan(1);
    expect(PULSE_STILL).toBeGreaterThan(0);
    expect(PULSE_STILL).toBeLessThan(1);
  });
});
