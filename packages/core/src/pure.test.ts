import { describe, expect, it } from "vitest";
import { AppError, codeOf, messageFor } from "./errors";
import { createEvents } from "./events";
import { haversineMeters, msToKmh } from "./geo";
import { parseLink } from "./links";
import { createChunkedStorage, type KeyValueStore } from "./secureStorage";
import { createStore } from "./store";
import { createPinRegistry } from "./pins";
import type { MapPin } from "./contracts";
import { formatDaySet, previousWeekStart, torontoWeekStart } from "./week";

describe("torontoWeekStart", () => {
  it("rolls over at Monday 00:00 Toronto time, matching the database", () => {
    expect(torontoWeekStart(new Date("2025-10-06T03:59:59Z"))).toBe("2025-09-29");
    expect(torontoWeekStart(new Date("2025-10-06T04:00:00Z"))).toBe("2025-10-06");
    expect(torontoWeekStart(new Date("2025-11-03T04:59:59Z"))).toBe("2025-10-27");
    expect(torontoWeekStart(new Date("2025-11-03T05:00:00Z"))).toBe("2025-11-03");
    expect(torontoWeekStart(new Date("2025-03-10T03:59:59Z"))).toBe("2025-03-03");
    expect(torontoWeekStart(new Date("2025-03-10T04:00:00Z"))).toBe("2025-03-10");
    expect(torontoWeekStart(new Date("2025-10-12T23:59:59-04:00"))).toBe("2025-10-06");
  });
  it("computes the previous week and formats a day", () => {
    expect(previousWeekStart("2025-10-06")).toBe("2025-09-29");
    expect(formatDaySet("2025-10-08")).toMatch(/Wed/);
  });
});

describe("geo", () => {
  it("measures distance and converts speed", () => {
    const d = haversineMeters({ lat: 43.6532, lng: -79.3832 }, { lat: 43.6632, lng: -79.3832 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
    expect(msToKmh(10)).toBeCloseTo(36);
    expect(haversineMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
});

describe("parseLink", () => {
  it("parses invite and crew links from https and the custom scheme", () => {
    expect(parseLink("https://go.rdv.test/i/abc234def567")).toEqual({ kind: "invite", code: "ABC234DEF567" });
    expect(parseLink("https://go.rdv.test/c/xyz?x=1")).toEqual({ kind: "crew", code: "XYZ" });
    expect(parseLink("rdvgarage://i/CODE22")).toEqual({ kind: "invite", code: "CODE22" });
    expect(parseLink("rdvgarage://crew/CODE22")).toEqual({ kind: "crew", code: "CODE22" });
  });
  it("parses confirmation and reset links", () => {
    expect(parseLink("https://go.rdv.test/confirm")).toEqual({ kind: "confirmed" });
    expect(parseLink("rdvgarage://reset#access_token=a.b.c&refresh_token=r1&type=recovery")).toEqual({ kind: "reset", accessToken: "a.b.c", refreshToken: "r1" });
    expect(parseLink("https://go.rdv.test/reset#type=recovery")).toBeNull();
  });
  it("ignores unknown links", () => {
    expect(parseLink("https://go.rdv.test/")).toBeNull();
    expect(parseLink("not a url")).toBeNull();
  });
});

describe("errors", () => {
  it("maps stable codes to messages and falls back", () => {
    expect(messageFor(new AppError("handle_taken"))).toBe("That handle is taken.");
    expect(messageFor(new Error("boom"))).toMatch(/went wrong/);
    expect(codeOf(new AppError("rate_limited"))).toBe("rate_limited");
  });
});

describe("events and store", () => {
  it("delivers typed events and unsubscribes", () => {
    const events = createEvents();
    const seen: string[] = [];
    const off = events.on("session.ended", (e) => seen.push(e.sessionId));
    events.emit({ type: "session.ended", sessionId: "a" });
    off();
    events.emit({ type: "session.ended", sessionId: "b" });
    expect(seen).toEqual(["a"]);
  });
  it("notifies store subscribers only on change", () => {
    const store = createStore(1);
    let calls = 0;
    store.subscribe(() => calls++);
    store.set(1);
    store.set((n) => n + 1);
    expect(store.get()).toBe(2);
    expect(calls).toBe(1);
  });
});

describe("chunked secure storage", () => {
  function memoryStore(): KeyValueStore & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItemAsync: async (k) => data.get(k) ?? null,
      setItemAsync: async (k, v) => {
        if (v.length > 2048) throw new Error("value too large");
        data.set(k, v);
      },
      deleteItemAsync: async (k) => void data.delete(k),
    };
  }
  it("round-trips a value larger than one secure store entry and cleans up", async () => {
    const mem = memoryStore();
    const storage = createChunkedStorage(mem);
    const big = "x".repeat(5000);
    await storage.setItem("session", big);
    expect(await storage.getItem("session")).toBe(big);
    await storage.setItem("session", "short");
    expect(await storage.getItem("session")).toBe("short");
    expect([...mem.data.keys()].length).toBe(2);
    await storage.removeItem("session");
    expect(await storage.getItem("session")).toBeNull();
    expect(mem.data.size).toBe(0);
  });
});

describe("pin registry", () => {
  const pin = (id: string, onPress = () => undefined): MapPin => ({ id, lat: 43.7, lng: -79.4, label: id, kind: "rdv", colorKey: 0, onPress });

  it("merges sources, namespaces ids and follows updates", () => {
    const registry = createPinRegistry();
    const a = createStore<MapPin[]>([pin("1")]);
    const b = createStore<MapPin[]>([pin("1")]);
    registry.register({ id: "rdvs", pins: a });
    const off = registry.register({ id: "places", pins: b });
    expect(registry.store.get().map((p) => p.id)).toEqual(["rdvs:1", "places:1"]);
    a.set([pin("1"), pin("2")]);
    expect(registry.store.get()).toHaveLength(3);
    off();
    b.set([pin("9")]);
    expect(registry.store.get().map((p) => p.id)).toEqual(["rdvs:1", "rdvs:2"]);
  });

  it("sends a press to the owning pin only", () => {
    const registry = createPinRegistry();
    const hit: string[] = [];
    registry.register({ id: "rdvs", pins: createStore([pin("1", () => void hit.push("rdvs"))]) });
    registry.register({ id: "places", pins: createStore([pin("1", () => void hit.push("places"))]) });
    registry.press("places:1");
    registry.press("nope:1");
    expect(hit).toEqual(["places"]);
  });
});
