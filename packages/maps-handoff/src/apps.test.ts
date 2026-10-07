import { describe, expect, it } from "vitest";
import { directionsUrl, planHandoff, webFallbackUrl } from "./apps";
import { createHandoff, detectInstalled, type HandoffDeps } from "./handoff";
import { createMapsPrefs } from "./prefs";

const target = { lat: 43.6532, lng: -79.3832, label: "Shop & Co / #1" };

describe("directionsUrl", () => {
  it("builds each link from the spec", () => {
    expect(directionsUrl("waze", target)).toBe("https://waze.com/ul?ll=43.6532,-79.3832&navigate=yes");
    expect(directionsUrl("google", target)).toBe("https://www.google.com/maps/dir/?api=1&destination=43.6532,-79.3832");
    expect(directionsUrl("apple", target)).toBe("https://maps.apple.com/?daddr=43.6532,-79.3832&q=Shop%20%26%20Co%20%2F%20%231");
  });
  it("sends the label only to Apple Maps", () => {
    expect(directionsUrl("waze", target)).not.toContain("Shop");
    expect(directionsUrl("google", target)).not.toContain("Shop");
  });
  it("keeps negative and long coordinates stable", () => {
    expect(directionsUrl("waze", { lat: -0.5, lng: 151.123456789, label: "x" })).toContain("ll=-0.5,151.123457");
  });
  it("web fallback is the Waze link", () => {
    expect(webFallbackUrl(target)).toBe(directionsUrl("waze", target));
  });
});

describe("planHandoff", () => {
  it("opens Waze by default when installed", () => {
    expect(planHandoff("ios", null, ["waze", "apple"])).toEqual({ kind: "open", app: "waze" });
    expect(planHandoff("android", null, ["waze", "google"])).toEqual({ kind: "open", app: "waze" });
  });
  it("opens the chosen app when installed", () => {
    expect(planHandoff("ios", "google", ["waze", "apple", "google"])).toEqual({ kind: "open", app: "google" });
  });
  it("offers the installed others when the chosen one is missing", () => {
    expect(planHandoff("ios", null, ["apple"])).toEqual({ kind: "choose", missing: "waze", options: ["apple"] });
    expect(planHandoff("android", "google", ["waze"])).toEqual({ kind: "choose", missing: "google", options: ["waze"] });
  });
  it("falls back to the web link when nothing is installed", () => {
    expect(planHandoff("android", null, [])).toEqual({ kind: "web" });
  });
  it("never uses Apple Maps on Android", () => {
    expect(planHandoff("android", "apple", ["apple", "google"])).toEqual({ kind: "choose", missing: "waze", options: ["google"] });
  });
});

const deps = (over: Partial<HandoffDeps> = {}) => {
  const opened: string[] = [];
  const saved: string[] = [];
  const d: HandoffDeps = {
    os: "ios",
    getPreferred: () => null,
    setPreferred: (a) => void saved.push(a),
    canOpen: async (url) => url === "waze://",
    open: async (url) => void opened.push(url),
    choose: async () => null,
    confirmRemember: async () => false,
    ...over,
  };
  return { d, opened, saved };
};

describe("detectInstalled", () => {
  it("probes schemes and always finds Apple Maps on iPhone", async () => {
    expect(await detectInstalled("ios", async (u) => u === "comgooglemaps://")).toEqual(["apple", "google"]);
    expect(await detectInstalled("android", async () => false)).toEqual([]);
  });
  it("treats a failing probe as not installed", async () => {
    expect(await detectInstalled("android", () => Promise.reject(new Error("x")))).toEqual([]);
  });
});

describe("openDirections", () => {
  it("opens Waze when installed", async () => {
    const { d, opened } = deps();
    await createHandoff(d).openDirections(target);
    expect(opened).toEqual([directionsUrl("waze", target)]);
  });
  it("opens the web link when nothing is installed on Android", async () => {
    const { d, opened } = deps({ os: "android", canOpen: async () => false });
    await createHandoff(d).openDirections(target);
    expect(opened).toEqual([webFallbackUrl(target)]);
  });
  it("offers installed apps, opens the pick and remembers when asked", async () => {
    const { d, opened, saved } = deps({ canOpen: async () => false, choose: async () => "apple", confirmRemember: async () => true });
    await createHandoff(d).openDirections(target);
    expect(opened).toEqual([directionsUrl("apple", target)]);
    expect(saved).toEqual(["apple"]);
  });
  it("does not remember when declined and does nothing on cancel", async () => {
    const a = deps({ canOpen: async () => false, choose: async () => "apple" });
    await createHandoff(a.d).openDirections(target);
    expect(a.saved).toEqual([]);
    const b = deps({ canOpen: async () => false });
    await createHandoff(b.d).openDirections(target);
    expect(b.opened).toEqual([]);
  });
});

describe("maps prefs", () => {
  it("loads a stored app, ignores junk and saves changes", async () => {
    const data = new Map<string, string>([["rdv.maps.app", "google"]]);
    const kv = { get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
    const prefs = createMapsPrefs(kv);
    await prefs.load();
    expect(prefs.store.get()).toBe("google");
    prefs.set("waze");
    expect(data.get("rdv.maps.app")).toBe("waze");
    data.set("rdv.maps.app", "bogus");
    const other = createMapsPrefs(kv);
    await other.load();
    expect(other.store.get()).toBeNull();
  });
});
