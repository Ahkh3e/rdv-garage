import type { GeoPoint } from "@rdv/core";

// Two decimals is about 1 km, so the search never carries a precise position.
export const coarse = (value: number) => Math.round(value * 100) / 100;

export const coarseBias = (point: GeoPoint | null): GeoPoint | null => (point ? { lat: coarse(point.lat), lng: coarse(point.lng) } : null);
