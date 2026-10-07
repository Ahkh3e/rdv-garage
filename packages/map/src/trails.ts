import { haversineMeters } from "@rdv/core";

// A movement trail is the last few minutes of positions a crew member has already shared. It lives in memory on each phone
// only: nothing here is stored, uploaded or kept after the app closes.
export interface TrailPoint {
  lng: number;
  lat: number;
  ts: number;
}

export const TRAIL_MS = 3 * 60 * 1000;
export const MIN_STEP_M = 6;
export const MAX_GAP_M = 600;
export const MAX_GAP_MS = 60 * 1000;
export const MAX_POINTS = 160;

// Adds a point to a trail. A gap in time or a jump in distance starts a fresh trail so a lost signal never draws a long line.
export function appendTrail(trail: TrailPoint[], point: TrailPoint, now: number): TrailPoint[] {
  const last = trail[trail.length - 1];
  let next = trail;
  if (!last) next = [point];
  else {
    const metres = haversineMeters({ lat: last.lat, lng: last.lng }, { lat: point.lat, lng: point.lng });
    if (point.ts - last.ts > MAX_GAP_MS || metres > MAX_GAP_M) next = [point];
    else if (metres >= MIN_STEP_M) next = [...trail, point];
  }
  const fresh = next.filter((p) => now - p.ts <= TRAIL_MS);
  return fresh.length > MAX_POINTS ? fresh.slice(fresh.length - MAX_POINTS) : fresh;
}

export interface TrailSet {
  color: string;
  points: TrailPoint[];
}

// One short line per segment so the tail can fade: newest segments are strongest, the oldest almost gone.
export function trailFeatures(trails: Record<string, TrailSet>, now: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [id, trail] of Object.entries(trails)) {
    for (let i = 1; i < trail.points.length; i++) {
      const a = trail.points[i - 1]!;
      const b = trail.points[i]!;
      const age = Math.min(1, Math.max(0, (now - b.ts) / TRAIL_MS));
      features.push({
        type: "Feature",
        id: `${id}-${i}`,
        properties: { color: trail.color, a: Math.max(0.08, 0.9 * (1 - age)) },
        geometry: { type: "LineString", coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
