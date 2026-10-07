import { haversineMeters } from "@rdv/core/geo";
import { ROADS } from "./roads";

export type RouteStyle = "city" | "highway";

export interface Point {
  lat: number;
  lng: number;
}

// Road-following loops around Toronto, snapped to OpenStreetMap roads (scripts/make-routes.mjs). City: downtown streets.
// Highway: the Gardiner and the DVP northbound.
export const ROUTES: Record<RouteStyle, Point[]> = {
  city: [...ROADS.city],
  highway: [...ROADS.highway],
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Step {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
}

// Walks a route in a loop at a wandering speed, with the odd stop. Deterministic for a given seed.
export class Walker {
  private leg = 0;
  private legProgressM = 0;
  private speedKmh: number;
  private target: number;
  private stoppedFor = 0;
  private readonly rand: () => number;
  private readonly range: [number, number];

  constructor(private readonly points: Point[], style: RouteStyle, seed: number, startOffset = 0) {
    this.rand = mulberry32(seed);
    this.range = style === "highway" ? [90, 170] : [25, 70];
    this.speedKmh = this.range[0];
    this.target = this.speedKmh;
    this.leg = startOffset % points.length;
  }

  step(dtSeconds: number): Step {
    if (this.stoppedFor > 0) {
      this.stoppedFor -= dtSeconds;
      this.speedKmh = 0;
    } else {
      if (this.rand() < 0.02) this.stoppedFor = 5 + this.rand() * 20;
      if (this.rand() < 0.2) this.target = this.range[0] + this.rand() * (this.range[1] - this.range[0]);
      this.speedKmh += (this.target - this.speedKmh) * Math.min(1, dtSeconds / 6);
    }
    let remaining = (this.speedKmh / 3.6) * dtSeconds;
    let from = this.points[this.leg]!;
    let to = this.points[(this.leg + 1) % this.points.length]!;
    let legLength = haversineMeters(from, to);
    this.legProgressM += remaining;
    while (this.legProgressM >= legLength) {
      this.legProgressM -= legLength;
      this.leg = (this.leg + 1) % this.points.length;
      from = this.points[this.leg]!;
      to = this.points[(this.leg + 1) % this.points.length]!;
      legLength = haversineMeters(from, to);
      remaining = 0;
    }
    const t = legLength === 0 ? 0 : this.legProgressM / legLength;
    return {
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
      heading: bearing(from, to),
      speedKmh: this.speedKmh,
    };
  }
}

export function bearing(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
