import { CAR_COLORS, CAR_COLOR_KEYS, carColorHex, carColorKey } from "../../../packages/core/src/carColors";
import { CAR_ICONS, CAR_ICON_KEYS, DEFAULT_CAR_ICON, carIconKey } from "../../../packages/core/src/carIcons";

describe("car icons", () => {
  it("has eight models, each with a body and four wheels inside the grid", () => {
    expect(CAR_ICON_KEYS).toHaveLength(8);
    for (const key of CAR_ICON_KEYS) {
      const shape = CAR_ICONS[key];
      expect(shape.name.length).toBeGreaterThan(0);
      expect(shape.body.startsWith("M")).toBe(true);
      expect(shape.wheels).toHaveLength(4);
      for (const [x, y, w, h] of shape.wheels) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(40);
        expect(y + h).toBeLessThanOrEqual(40);
      }
    }
  });

  it("falls back to the default for unknown values", () => {
    expect(carIconKey("hyper")).toBe("hyper");
    expect(carIconKey("tractor")).toBe(DEFAULT_CAR_ICON);
    expect(carIconKey(null)).toBe(DEFAULT_CAR_ICON);
  });
});

describe("car colours", () => {
  it("has ten palette colours with valid hex values", () => {
    expect(CAR_COLOR_KEYS).toEqual(["blue", "cyan", "green", "lime", "yellow", "orange", "red", "pink", "purple", "white"]);
    for (const key of CAR_COLOR_KEYS) expect(CAR_COLORS[key].hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(new Set(CAR_COLOR_KEYS.map((k) => CAR_COLORS[k].hex)).size).toBe(10);
  });

  it("maps keys to hex and unknown values to null, meaning the crew colour", () => {
    expect(carColorKey("pink")).toBe("pink");
    expect(carColorKey("teal")).toBeNull();
    expect(carColorKey(null)).toBeNull();
    expect(carColorHex("pink")).toBe(CAR_COLORS.pink.hex);
    expect(carColorHex(undefined)).toBeNull();
  });
});
