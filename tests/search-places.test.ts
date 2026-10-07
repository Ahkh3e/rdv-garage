import { describe, expect, it } from "vitest";
import { ANON_KEY, API_URL, createUser, invokeAs, sql } from "./helpers";
import { MAX_RESPONSE_BYTES, rpcFailure, searchPlaces } from "../supabase/functions/search_places/handler";
import { cleanText, coarse, parseBias, parsePhoton, photonUrl } from "../supabase/functions/search_places/photon";

describe("search_places request handling", () => {
  it("requires a signed-in caller", async () => {
    const res = await fetch(`${API_URL}/functions/v1/search_places`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ text: "cn tower" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects text under three characters without calling the geocoder", async () => {
    const u = await createUser();
    for (const text of ["", "a", "ab", "  ab  "]) {
      const res = await invokeAs(u.client, "search_places", { text });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_query" });
    }
    expect((await invokeAs(u.client, "search_places", {})).body).toEqual({ error: "invalid_query" });
    expect((await invokeAs(u.client, "search_places", { text: "x".repeat(101) })).body).toEqual({ error: "invalid_query" });
  });

  it("rate limits per account", async () => {
    const a = await createUser();
    const b = await createUser();
    await sql("insert into private.rate_limits (key, window_start, count) values ($1, now(), 600)", [`search_places:${a.id}`]);
    const limited = await invokeAs(a.client, "search_places", { text: "ab" });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "rate_limited" });
    const other = await invokeAs(b.client, "search_places", { text: "ab" });
    expect(other.status).toBe(400);
  });
});

describe("photon request and response", () => {
  it("rounds the bias to about a kilometre and forwards only text and the bias", () => {
    expect(coarse(43.653226)).toBe(43.65);
    expect(coarse(-79.383184)).toBe(-79.38);
    expect(parseBias({ lat: 43.653226, lng: -79.383184 })).toEqual({ lat: 43.65, lng: -79.38 });
    expect(parseBias({ lat: 100, lng: 0 })).toBeNull();
    expect(parseBias({ lat: "1", lng: 0 })).toBeNull();
    expect(parseBias(null)).toBeNull();
    const url = new URL(photonUrl("https://photon.test/", "tim hortons", { lat: 43.65, lng: -79.38 }));
    expect(url.origin + url.pathname).toBe("https://photon.test/api");
    expect([...url.searchParams.keys()].sort()).toEqual(["lang", "lat", "limit", "lon", "q"]);
    expect(url.searchParams.get("q")).toBe("tim hortons");
    expect(new URL(photonUrl("https://photon.test", "cn tower", null)).searchParams.has("lat")).toBe(false);
  });

  it("trims text and enforces the length window", () => {
    expect(cleanText("  cn   tower ")).toBe("cn tower");
    expect(cleanText("ab")).toBeNull();
    expect(cleanText(42)).toBeNull();
  });

  it("maps Photon features to name, kind, address and position", () => {
    const body = {
      features: [
        { geometry: { coordinates: [-79.38, 43.65] }, properties: { name: "Tim Hortons", osm_key: "amenity", osm_value: "cafe", housenumber: "10", street: "Queen St", city: "Toronto", state: "Ontario" } },
        { geometry: { coordinates: [-79.38, 43.65] }, properties: { name: "Tim Hortons", osm_value: "cafe", housenumber: "10", street: "Queen St", city: "Toronto", state: "Ontario" } },
        { geometry: { coordinates: [-79.4, 43.7] }, properties: { type: "house", housenumber: "5", street: "King St", city: "Toronto" } },
        { geometry: { coordinates: [-79.4, 43.7] }, properties: { osm_value: "fast_food" } },
        { geometry: null, properties: { name: "Broken" } },
      ],
    };
    expect(parsePhoton(body)).toEqual([
      { name: "Tim Hortons", kind: "Cafe", address: "10 Queen St, Toronto, Ontario", lat: 43.65, lng: -79.38 },
      { name: "5 King St", kind: "Address", address: "Toronto", lat: 43.7, lng: -79.4 },
    ]);
    expect(parsePhoton({})).toEqual([]);
  });
});

describe("search handler", () => {
  const feature = { geometry: { coordinates: [-79.38, 43.65] }, properties: { name: "CN Tower", osm_value: "tower" } };
  const photon = (res: () => Response) => {
    const urls: string[] = [];
    const doFetch = (async (url: string) => (urls.push(url), res())) as unknown as typeof fetch;
    return { urls, doFetch };
  };

  it("forwards only q, lat and lon with a coarsened bias", async () => {
    const { urls, doFetch } = photon(() => new Response(JSON.stringify({ features: [feature] })));
    const out = await searchPlaces({ text: " cn tower ", bias: { lat: 43.653226, lng: -79.383184 }, handle: "x", crew: "y" }, "http://photon.test", doFetch);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ results: [{ name: "CN Tower", kind: "Tower", address: null, lat: 43.65, lng: -79.38 }] });
    const url = new URL(urls[0]!);
    expect(url.searchParams.get("q")).toBe("cn tower");
    expect(url.searchParams.get("lat")).toBe("43.65");
    expect(url.searchParams.get("lon")).toBe("-79.38");
    expect([...url.searchParams.keys()].sort()).toEqual(["lang", "lat", "limit", "lon", "q"]);
  });

  it("answers search_unavailable when the geocoder fails, is unreachable or sends junk", async () => {
    const unavailable = { status: 502, body: { error: "search_unavailable" } };
    expect(await searchPlaces({ text: "cn tower" }, "http://photon.test", photon(() => new Response("no", { status: 500 })).doFetch)).toEqual(unavailable);
    expect(await searchPlaces({ text: "cn tower" }, "http://photon.test", (() => Promise.reject(new Error("down"))) as unknown as typeof fetch)).toEqual(unavailable);
    expect(await searchPlaces({ text: "cn tower" }, "http://photon.test", photon(() => new Response("<html>")).doFetch)).toEqual(unavailable);
  });

  it("refuses an oversized geocoder response", async () => {
    const big = JSON.stringify({ features: [], pad: "x".repeat(MAX_RESPONSE_BYTES) });
    const out = await searchPlaces({ text: "cn tower" }, "http://photon.test", photon(() => new Response(big)).doFetch);
    expect(out).toEqual({ status: 502, body: { error: "search_unavailable" } });
    const declared = await searchPlaces({ text: "cn tower" }, "http://photon.test", photon(() => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } })).doFetch);
    expect(declared.status).toBe(502);
  });

  it("rejects bodies that are not a plain object", async () => {
    for (const body of [null, "cn tower", 5, ["cn tower"]]) {
      expect(await searchPlaces(body, "http://photon.test", photon(() => new Response("{}")).doFetch)).toEqual({ status: 400, body: { error: "invalid_request" } });
    }
  });

  it("maps only rate_limited rpc errors to 429", () => {
    expect(rpcFailure(null)).toBeNull();
    expect(rpcFailure({ message: "rate_limited" })).toEqual({ status: 429, body: { error: "rate_limited" } });
    expect(rpcFailure({ message: "connection refused" })).toEqual({ status: 502, body: { error: "search_unavailable" } });
  });
});
