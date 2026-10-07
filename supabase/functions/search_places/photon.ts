export const MIN_TEXT = 3;
export const MAX_TEXT = 100;
export const RESULT_LIMIT = 8;

export interface PlaceResult {
  name: string;
  kind: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface Bias {
  lat: number;
  lng: number;
}

// Two decimals is about 1 km, whatever precision the caller sent.
export function coarse(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseBias(raw: unknown): Bias | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: coarse(lat), lng: coarse(lng) };
}

export function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  return text.length >= MIN_TEXT && text.length <= MAX_TEXT ? text : null;
}

export function photonUrl(base: string, text: string, bias: Bias | null): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/api`);
  url.searchParams.set("q", text);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("lang", "en");
  if (bias) {
    url.searchParams.set("lat", String(bias.lat));
    url.searchParams.set("lon", String(bias.lng));
  }
  return url.toString();
}

const humanize = (value: string) => {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const KIND_BY_TYPE: Record<string, string> = { house: "Address", street: "Street", city: "City", district: "District", locality: "Locality" };

export function parsePhoton(body: unknown): PlaceResult[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const feature of features) {
    const props = (feature?.properties ?? {}) as Record<string, unknown>;
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") continue;
    const text = (key: string) => (typeof props[key] === "string" && props[key] ? (props[key] as string) : null);
    const street = [text("housenumber"), text("street")].filter(Boolean).join(" ") || null;
    const name = text("name") ?? street;
    if (!name) continue;
    const address = [street !== name ? street : null, text("city") ?? text("town") ?? text("district"), text("state")].filter(Boolean).join(", ") || null;
    const value = text("osm_value");
    const type = text("type");
    const kind = (type && KIND_BY_TYPE[type]) || (value && value !== "yes" ? humanize(value) : null) || (type ? humanize(type) : "Place");
    const key = `${name}|${address}|${coords[1].toFixed(4)}|${coords[0].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind, address, lat: coords[1], lng: coords[0] });
  }
  return out;
}
