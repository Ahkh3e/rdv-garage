import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Geocoder, Place, Poi } from "@rdv/core";
import { AppError } from "@rdv/core/errors";
import { coarse, coarseBias } from "./bias";
import { CATEGORIES, categoryOf, formatDistance, nearby } from "./categories";
import { debounce } from "./debounce";
import { createGeocoder } from "./geocoder";
import { canRemove, expiresIn, pinFromRow, placeOfPin, toMapPin, unexpired, type PinRow } from "./pins";
import { RECENTS_KEY, RECENTS_MAX, addRecent, createRecents } from "./recents";
import { createSearch } from "./search";
import { defaultLabel, labelError, noteError, queryReady } from "./validation";

const poi = (name: string, lat: number, lng: number, cls: string, subclass: string | null = null): Poi => ({ name, lat, lng, cls, subclass });

describe("coarse bias", () => {
  it("rounds to two decimals, about 1 km", () => {
    expect(coarse(43.653226)).toBe(43.65);
    expect(coarse(-79.386)).toBe(-79.39);
    expect(coarseBias({ lat: 43.653226, lng: -79.383184 })).toEqual({ lat: 43.65, lng: -79.38 });
    expect(coarseBias(null)).toBeNull();
  });
});

describe("categories", () => {
  it("maps tile classes and subclasses to the six categories", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["fuel", "food", "coffee", "parking", "carwash", "ev"]);
    expect(categoryOf({ cls: "fuel", subclass: "fuel" })).toBe("fuel");
    expect(categoryOf({ cls: "restaurant", subclass: null })).toBe("food");
    expect(categoryOf({ cls: "fast_food", subclass: "burger" })).toBe("food");
    expect(categoryOf({ cls: "cafe", subclass: "coffee_shop" })).toBe("coffee");
    expect(categoryOf({ cls: "shop", subclass: "cafe" })).toBe("coffee");
    expect(categoryOf({ cls: "parking", subclass: null })).toBe("parking");
    expect(categoryOf({ cls: "car_wash", subclass: null })).toBe("carwash");
    expect(categoryOf({ cls: "charging_station", subclass: null })).toBe("ev");
    expect(categoryOf({ cls: "school", subclass: "school" })).toBeNull();
  });

  it("lists a category by straight-line distance from the map center", () => {
    const center = { lat: 43.65, lng: -79.38 };
    const pois = [
      poi("Far", 43.7, -79.38, "fuel"),
      poi("Near", 43.651, -79.38, "fuel"),
      poi("Middle", 43.66, -79.38, "gas"),
      poi("Cafe", 43.6501, -79.38, "cafe"),
    ];
    const results = nearby(pois, "fuel", center);
    expect(results.map((r) => r.place.name)).toEqual(["Near", "Middle", "Far"]);
    expect(results[0]!.meters).toBeLessThan(results[1]!.meters);
    expect(results[0]!.place).toMatchObject({ kind: "Fuel", address: null, lat: 43.651, lng: -79.38 });
    expect(nearby(pois, "fuel", center, 2)).toHaveLength(2);
    expect(nearby(pois, "ev", center)).toEqual([]);
  });

  it("formats straight-line distances", () => {
    expect(formatDistance(3)).toBe("10 m");
    expect(formatDistance(347)).toBe("350 m");
    expect(formatDistance(1540)).toBe("1.5 km");
    expect(formatDistance(23000)).toBe("23 km");
  });
});

describe("validation", () => {
  it("accepts labels of 3 to 40 characters and notes up to 140", () => {
    expect(labelError("ab")).toBe("pin_label_invalid");
    expect(labelError("   ab   ")).toBe("pin_label_invalid");
    expect(labelError("abc")).toBeNull();
    expect(labelError("x".repeat(40))).toBeNull();
    expect(labelError("x".repeat(41))).toBe("pin_label_invalid");
    expect(noteError("n".repeat(140))).toBeNull();
    expect(noteError("n".repeat(141))).toBe("pin_note_invalid");
    expect(noteError("")).toBeNull();
  });
  it("needs three characters before a search", () => {
    expect(queryReady("ab")).toBe(false);
    expect(queryReady("  ab ")).toBe(false);
    expect(queryReady("abc")).toBe(true);
  });
  it("defaults the label to the place name or address, within the limit", () => {
    expect(defaultLabel({ name: "Tim Hortons", address: "1 Main" })).toBe("Tim Hortons");
    expect(defaultLabel({ name: "", address: "1 Main St" })).toBe("1 Main St");
    expect(defaultLabel(null)).toBe("Dropped pin");
    expect(defaultLabel({ name: "x".repeat(60), address: null }).length).toBeLessThanOrEqual(40);
  });
});

describe("debounce and search", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after the pause with the last arguments", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a");
    vi.advanceTimersByTime(200);
    d("b");
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith("b");
    d("c");
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  const place = (name: string): Place => ({ name, kind: "Cafe", address: null, lat: 1, lng: 2 });

  it("waits for three characters and a pause, and sends only text and a coarse bias", async () => {
    const search = vi.fn(async (_text: string, _bias: unknown) => [place("A")]);
    const geocoder: Geocoder = { search };
    const s = createSearch(geocoder, () => ({ lat: 43.653226, lng: -79.383184 }), 300);
    s.setQuery("ti");
    s.setQuery("tim");
    vi.advanceTimersByTime(299);
    expect(search).not.toHaveBeenCalled();
    s.setQuery("tim ");
    s.setQuery("tim h");
    vi.advanceTimersByTime(300);
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("tim h", { lat: 43.65, lng: -79.38 });
    expect(s.state.get()).toMatchObject({ status: "done", results: [place("A")] });
  });

  it("clears results when the text gets short and ignores stale replies", async () => {
    let release: (v: Place[]) => void = () => undefined;
    const geocoder: Geocoder = { search: () => new Promise((resolve) => (release = resolve)) };
    const s = createSearch(geocoder, () => null, 100);
    s.setQuery("abcd");
    vi.advanceTimersByTime(100);
    s.setQuery("ab");
    release([place("late")]);
    await vi.runAllTimersAsync();
    expect(s.state.get()).toMatchObject({ status: "idle", results: [], query: "ab" });
  });

  it("reports the error code", async () => {
    const geocoder: Geocoder = { search: async () => Promise.reject(new AppError("rate_limited")) };
    const s = createSearch(geocoder, () => null, 100);
    s.setQuery("abcd");
    await vi.runAllTimersAsync();
    expect(s.state.get()).toMatchObject({ status: "error", error: "rate_limited" });
  });
});

describe("geocoder", () => {
  it("sends text and a rounded bias, and returns the results list", async () => {
    const invoke = vi.fn(async () => ({ results: [{ name: "X", kind: "Cafe", address: null, lat: 1, lng: 2 }] }));
    const geocoder = createGeocoder(invoke);
    expect(await geocoder.search("cn tower", { lat: 43.6426, lng: -79.3871 })).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith({ text: "cn tower", bias: { lat: 43.64, lng: -79.39 } });
    expect(await createGeocoder(async () => ({})).search("abc", null)).toEqual([]);
  });
});

describe("recents", () => {
  it("keeps the newest first, without duplicates, up to the limit", () => {
    expect(addRecent(["b", "a"], "A")).toEqual(["A", "b"]);
    expect(addRecent(["a"], "   ")).toEqual(["a"]);
    const many = Array.from({ length: 12 }, (_, i) => `q${i}`).reduce((list, q) => addRecent(list, q), [] as string[]);
    expect(many).toHaveLength(RECENTS_MAX);
    expect(many[0]).toBe("q11");
  });

  it("saves and loads from the device store", async () => {
    const data = new Map<string, string>();
    const kv = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
    const recents = createRecents(kv);
    recents.add("cn tower");
    recents.add("tim hortons");
    expect(JSON.parse(data.get(RECENTS_KEY)!)).toEqual(["tim hortons", "cn tower"]);
    const again = createRecents(kv);
    await again.load();
    expect(again.store.get()).toEqual(["tim hortons", "cn tower"]);
    again.clear();
    expect(JSON.parse(data.get(RECENTS_KEY)!)).toEqual([]);
    data.set(RECENTS_KEY, "not json");
    await again.load();
    expect(again.store.get()).toEqual([]);
  });
});

describe("pins", () => {
  const row: PinRow = {
    id: "p1", dropper_id: "u1", dropper_handle: "ace", label: "Meet", note: null, address: "1 Main", lat: 43.7, lng: -79.4,
    expires_at: "2025-10-07T12:00:00Z", crew_ids: ["c1"],
  };
  it("parses rows, hides expired pins and counts down", () => {
    const pin = pinFromRow(row);
    expect(pin).toMatchObject({ id: "p1", dropperHandle: "ace", crewIds: ["c1"] });
    const before = Date.parse("2025-10-07T09:30:00Z");
    expect(unexpired([pin], before)).toHaveLength(1);
    expect(unexpired([pin], Date.parse("2025-10-07T12:00:01Z"))).toHaveLength(0);
    expect(expiresIn(pin, before)).toBe("3 h left");
    expect(expiresIn(pin, Date.parse("2025-10-07T11:30:00Z"))).toBe("30 min left");
    expect(pinFromRow({ ...row, crew_ids: null }).crewIds).toEqual([]);
  });
  it("lets the dropper or an owner of a listed crew remove", () => {
    const pin = pinFromRow(row);
    expect(canRemove(pin, "u1", [])).toBe(true);
    expect(canRemove(pin, "u2", [{ id: "c1", role: "owner" }])).toBe(true);
    expect(canRemove(pin, "u2", [{ id: "c2", role: "owner" }])).toBe(false);
    expect(canRemove(pin, "u2", [{ id: "c1", role: "member" }])).toBe(false);
  });
  it("draws a pin glyph in the crew colour key", () => {
    const pin = pinFromRow(row);
    const mapPin = toMapPin(pin, [{ id: "c0", styleIndex: 0 }, { id: "c1", styleIndex: 3 }], () => undefined);
    expect(mapPin).toMatchObject({ kind: "pin", colorKey: 3, lat: 43.7, lng: -79.4, label: "Meet" });
    expect(placeOfPin(pin)).toMatchObject({ name: "Meet", address: "1 Main" });
  });
});
