import { bearingDegrees, haversineMeters } from "@rdv/core";
import type { RoadIndex, Snap } from "./roadSnap";

// A movement trail is the last few minutes of positions a crew member has already shared. It lives in memory on each phone
// only: nothing here is stored, uploaded or kept after the app closes.
export interface TrailPoint {
  lng: number;
  lat: number;
  ts: number;
  // Set once the point has been matched to a road: where on the road it is, and the road's bends since the last point.
  snap?: Snap;
  via?: { lng: number; lat: number }[];
}

// The trail is limited by distance, not time, so its length never reveals how fast someone is going (decision 0007).
// The time limit only clears a trail once someone has stopped.
export const TRAIL_M = 450;
export const TRAIL_MS = 3 * 60 * 1000;
export const MIN_STEP_M = 6;
export const MAX_GAP_M = 600;
export const MAX_GAP_MS = 60 * 1000;
export const MAX_POINTS = 120;

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
  // Keep only the newest TRAIL_M metres of path.
  let walked = 0;
  let keepFrom = 0;
  for (let i = fresh.length - 1; i > 0; i--) {
    walked += haversineMeters(fresh[i - 1]!, fresh[i]!);
    if (walked > TRAIL_M) {
      keepFrom = i - 1;
      break;
    }
  }
  const trimmed = keepFrom > 0 ? fresh.slice(keepFrom) : fresh;
  return trimmed.length > MAX_POINTS ? trimmed.slice(trimmed.length - MAX_POINTS) : trimmed;
}

export interface TrailSet {
  color: string;
  points: TrailPoint[];
}

// Rounds the corners of a trail (Chaikin). Positions arrive a few seconds apart, so the raw line is a chain of chords.
export function smooth<T extends { lng: number; lat: number }>(points: T[], passes = 2): { lng: number; lat: number }[] {
  let out: { lng: number; lat: number }[] = points;
  for (let n = 0; n < passes && out.length > 2; n++) {
    const next: { lng: number; lat: number }[] = [out[0]!];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]!;
      const b = out[i + 1]!;
      next.push({ lng: a.lng * 0.75 + b.lng * 0.25, lat: a.lat * 0.75 + b.lat * 0.25 });
      next.push({ lng: a.lng * 0.25 + b.lng * 0.75, lat: a.lat * 0.25 + b.lat * 0.75 });
    }
    next.push(out[out.length - 1]!);
    out = next;
  }
  return out;
}

// Matches any points not yet on a road to the road index, and records the road's bends between consecutive matched points.
export function snapTrail(points: TrailPoint[], index: RoadIndex | null): void {
  if (!index || index.size === 0) return;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.snap) continue;
    const prev = points[i - 1];
    const heading = prev ? bearingDegrees(prev, p) : null;
    const snap = index.snap(p, heading);
    if (!snap) continue;
    p.snap = snap;
    p.via = prev?.snap ? (index.between(prev.snap, snap) ?? undefined) : undefined;
  }
}

// The line to draw: matched points sit on the road and follow its bends; a trail with no matched points is smoothed instead.
export function trailPath(points: TrailPoint[]): { lng: number; lat: number }[] {
  if (!points.some((p) => p.snap)) return smooth(points);
  const path: { lng: number; lat: number }[] = [];
  for (const p of points) {
    if (p.via) path.push(...p.via);
    path.push(p.snap ? { lng: p.snap.lng, lat: p.snap.lat } : { lng: p.lng, lat: p.lat });
  }
  return path;
}

// One short line per segment so the tail can fade by how far back along the path it is: strongest at the member, almost gone at the end.
export function trailFeatures(trails: Record<string, TrailSet>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const [id, trail] of Object.entries(trails)) {
    const points = trailPath(trail.points);
    let back = 0;
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const fade = Math.min(1, back / TRAIL_M);
      back += haversineMeters(a, b);
      features.push({
        type: "Feature",
        id: `${id}-${i}`,
        properties: { color: trail.color, a: Math.max(0.08, 0.9 * (1 - fade)) },
        geometry: { type: "LineString", coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
