import { TURN_THRESHOLD_DEG, angleDiff, holdHeading } from "../../../packages/map/src/heading";

describe("heading hold", () => {
  it("measures the short way round", () => {
    expect(angleDiff(350, 10)).toBeCloseTo(20, 6);
    expect(angleDiff(10, 350)).toBeCloseTo(20, 6);
    expect(angleDiff(90, 270)).toBeCloseTo(180, 6);
  });

  it("starts at the first heading", () => {
    expect(holdHeading(undefined, 123)).toBe(123);
  });

  it("keeps the angle through small left and right wobbles", () => {
    let held = 100;
    for (const wobble of [108, 94, 118, 85, 125, 78, 129]) held = holdHeading(held, wobble);
    expect(held).toBe(100);
  });

  it("follows once the heading has changed by more than the threshold", () => {
    expect(holdHeading(100, 100 + TURN_THRESHOLD_DEG + 1)).toBe(100 + TURN_THRESHOLD_DEG + 1);
    expect(holdHeading(100, 100 + TURN_THRESHOLD_DEG)).toBe(100);
  });

  it("handles a turn across north", () => {
    expect(holdHeading(350, 20)).toBe(350);
    expect(holdHeading(350, 40)).toBe(40);
  });
});
