import { SHEET_STOPS, atLeastHalf, biggerMap, snapStop, tapStop, zoomControlsFit } from "../../../packages/map/src/sheet";

const H = 800;

describe("crew sheet stops", () => {
  it("has three stops, the map taking three quarters, half and a quarter", () => {
    expect(SHEET_STOPS).toEqual({ large: 0.75, half: 0.5, small: 0.25 });
  });

  it("snaps a release to the nearest stop", () => {
    expect(snapStop(0.7 * H, H)).toBe("large");
    expect(snapStop(0.55 * H, H)).toBe("half");
    expect(snapStop(0.4 * H, H)).toBe("half");
    expect(snapStop(0.3 * H, H)).toBe("small");
  });

  it("lets a fling carry on to the next stop", () => {
    expect(snapStop(0.45 * H, H, -2)).toBe("small");
    expect(snapStop(0.55 * H, H, 2)).toBe("large");
    expect(snapStop(0.5 * H, H, 0)).toBe("half");
  });

  it("walks the stops on tap and turns around at each end", () => {
    let state = { stop: "half" as const, direction: 1 as 1 | -1 };
    const seen: string[] = [];
    let current = state;
    for (let i = 0; i < 6; i++) {
      current = tapStop(current.stop, current.direction) as typeof current;
      seen.push(current.stop);
    }
    expect(seen).toEqual(["small", "half", "large", "half", "small", "half"]);
  });

  it("opens the map back to at least halfway and one stop on a pull", () => {
    expect(atLeastHalf("small")).toBe("half");
    expect(atLeastHalf("half")).toBe("half");
    expect(atLeastHalf("large")).toBe("large");
    expect(biggerMap("small")).toBe("half");
    expect(biggerMap("half")).toBe("large");
  });

  it("fits the zoom buttons only when there is room", () => {
    expect(zoomControlsFit(437, 162, 116, 2)).toBe(true);
    expect(zoomControlsFit(333, 162, 116, 2)).toBe(false);
  });
});
