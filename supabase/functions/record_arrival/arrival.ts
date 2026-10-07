export const WINDOW_LEAD_MS = 60 * 60 * 1000;
const EARTH_M = 6371000;

export interface Reading {
  lat: number;
  lng: number;
}

export type Method = "live" | "here";

export function parseRequest(body: unknown): { rdvId: string; reading: Reading; method: Method } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const reading = b.position as Record<string, unknown> | undefined;
  if (typeof b.rdv_id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.rdv_id)) return null;
  if (!reading || typeof reading.lat !== "number" || typeof reading.lng !== "number") return null;
  if (!Number.isFinite(reading.lat) || !Number.isFinite(reading.lng)) return null;
  if (Math.abs(reading.lat) > 90 || Math.abs(reading.lng) > 180) return null;
  const method = b.method === "live" ? "live" : b.method === "here" || b.method === undefined ? "here" : null;
  if (!method) return null;
  return { rdvId: b.rdv_id, reading: { lat: reading.lat, lng: reading.lng }, method };
}

export function distanceMeters(a: Reading, b: Reading): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const insideRadius = (reading: Reading, place: Reading, radiusM: number) => distanceMeters(reading, place) <= radiusM;

export const insideWindow = (now: number, startsAt: number, endAt: number) => now >= startsAt - WINDOW_LEAD_MS && now <= endAt;
