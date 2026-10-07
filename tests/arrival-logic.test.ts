import { describe, expect, it } from "vitest";
import { distanceMeters, insideRadius, insideWindow, parseRequest, WINDOW_LEAD_MS } from "../supabase/functions/record_arrival/arrival";

const id = "00000000-0000-4000-8000-000000000000";

describe("record_arrival request and checks", () => {
  it("parses one reading and defaults the method to here", () => {
    expect(parseRequest({ rdv_id: id, position: { lat: 43.6, lng: -79.3 } })).toEqual({ rdvId: id, reading: { lat: 43.6, lng: -79.3 }, method: "here" });
    expect(parseRequest({ rdv_id: id, position: { lat: 43.6, lng: -79.3 }, method: "live" })?.method).toBe("live");
  });

  it("drops extra fields so nothing but the reading is kept", () => {
    const parsed = parseRequest({ rdv_id: id, position: { lat: 1, lng: 2, accuracy: 5, speed: 40 }, speed: 10 });
    expect(parsed?.reading).toEqual({ lat: 1, lng: 2 });
  });

  it("rejects malformed requests", () => {
    for (const body of [null, "x", {}, { rdv_id: id }, { rdv_id: "x", position: { lat: 1, lng: 1 } }, { rdv_id: id, position: { lat: 91, lng: 0 } }, { rdv_id: id, position: { lat: 0, lng: 181 } }, { rdv_id: id, position: { lat: NaN, lng: 0 } }, { rdv_id: id, position: { lat: 1, lng: 1 }, method: "gps" }]) {
      expect(parseRequest(body)).toBeNull();
    }
  });

  it("measures distance and compares with the radius", () => {
    const a = { lat: 43.65, lng: -79.38 };
    expect(distanceMeters(a, a)).toBe(0);
    expect(Math.round(distanceMeters(a, { lat: 43.651, lng: -79.38 }))).toBe(111);
    expect(insideRadius({ lat: 43.651, lng: -79.38 }, a, 150)).toBe(true);
    expect(insideRadius({ lat: 43.651, lng: -79.38 }, a, 100)).toBe(false);
  });

  it("opens the window one hour before the start and closes it at the end", () => {
    const start = 10_000_000;
    const end = start + 3600_000;
    expect(insideWindow(start - WINDOW_LEAD_MS - 1, start, end)).toBe(false);
    expect(insideWindow(start - WINDOW_LEAD_MS, start, end)).toBe(true);
    expect(insideWindow(end, start, end)).toBe(true);
    expect(insideWindow(end + 1, start, end)).toBe(false);
  });
});
