import type { CarIconKey } from "@rdv/core";

// Small 3D racecar models built from extruded shapes, drawn by the map itself so they tilt, turn and light up with the
// buildings around them. Units are metres in the car's own frame: x to the right of the nose, y forward, z up.
type Pt = [number, number];

interface Part {
  poly: Pt[];
  base: number;
  top: number;
  // body: the person's colour; glass: dark windows; trim: wheels and wings; roof: a lighter body colour
  role: "body" | "glass" | "trim" | "roof";
}

interface Spec {
  length: number;
  width: number;
  nose: number; // width of the front as a share of the full width
  tail: number; // width of the rear as a share of the full width
  height: number; // top of the body
  cabin: { from: number; to: number; width: number; top: number } | null; // y range as shares of the length, from rear
  wheel: { track: number; front: number; rear: number; w: number; d: number; h: number };
  wings?: { front?: { y: number; w: number }; rear?: { y: number; w: number; h: number } };
  open?: boolean; // open wheel: wheels sit outside the narrow body
}

const SPECS: Record<CarIconKey, Spec> = {
  gt: { length: 4.6, width: 1.9, nose: 0.62, tail: 0.78, height: 0.62, cabin: { from: 0.28, to: 0.7, width: 0.78, top: 1.28 }, wheel: { track: 1.9, front: 1.45, rear: -1.4, w: 0.28, d: 0.72, h: 0.62 } },
  formula: { length: 5.0, width: 1.0, nose: 0.4, tail: 0.8, height: 0.5, cabin: { from: 0.4, to: 0.58, width: 0.6, top: 0.95 }, wheel: { track: 1.75, front: 1.6, rear: -1.5, w: 0.42, d: 0.7, h: 0.66 }, wings: { front: { y: 2.35, w: 1.9 }, rear: { y: -2.35, w: 1.5, h: 1.05 } }, open: true },
  proto: { length: 4.9, width: 1.9, nose: 0.5, tail: 0.5, height: 0.55, cabin: { from: 0.22, to: 0.72, width: 0.6, top: 1.15 }, wheel: { track: 1.9, front: 1.5, rear: -1.4, w: 0.3, d: 0.72, h: 0.62 }, wings: { rear: { y: -2.3, w: 1.4, h: 0.95 } } },
  rally: { length: 4.0, width: 1.8, nose: 0.88, tail: 0.92, height: 0.82, cabin: { from: 0.12, to: 0.82, width: 0.86, top: 1.58 }, wheel: { track: 1.8, front: 1.25, rear: -1.2, w: 0.3, d: 0.78, h: 0.7 } },
  muscle: { length: 4.9, width: 2.0, nose: 0.92, tail: 0.92, height: 0.78, cabin: { from: 0.18, to: 0.58, width: 0.8, top: 1.4 }, wheel: { track: 2.0, front: 1.5, rear: -1.5, w: 0.32, d: 0.78, h: 0.7 } },
  hyper: { length: 4.7, width: 2.0, nose: 0.4, tail: 0.74, height: 0.5, cabin: { from: 0.3, to: 0.64, width: 0.7, top: 1.08 }, wheel: { track: 2.0, front: 1.45, rear: -1.4, w: 0.34, d: 0.76, h: 0.64 }, wings: { rear: { y: -2.3, w: 1.9, h: 0.95 } } },
  drift: { length: 4.3, width: 1.9, nose: 0.78, tail: 0.86, height: 0.66, cabin: { from: 0.22, to: 0.68, width: 0.78, top: 1.32 }, wheel: { track: 2.0, front: 1.35, rear: -1.3, w: 0.38, d: 0.76, h: 0.66 }, wings: { rear: { y: -2.05, w: 1.7, h: 1.12 } } },
  kart: { length: 2.0, width: 1.3, nose: 0.82, tail: 0.9, height: 0.28, cabin: { from: 0.34, to: 0.62, width: 0.5, top: 0.62 }, wheel: { track: 1.35, front: 0.66, rear: -0.62, w: 0.26, d: 0.4, h: 0.4 }, open: true },
};

// Rounds a corner-heavy outline into a smooth one (Chaikin), keeping it symmetrical.
function round(points: Pt[], passes = 2): Pt[] {
  let out = points;
  for (let n = 0; n < passes; n++) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      const b = out[(i + 1) % out.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out = next;
  }
  return out;
}

function hull(length: number, width: number, nose: number, tail: number): Pt[] {
  const hw = width / 2;
  const hl = length / 2;
  return [
    [-hw * nose, hl], [hw * nose, hl],
    [hw * 0.96, hl * 0.62], [hw, hl * 0.1], [hw, -hl * 0.45],
    [hw * tail, -hl], [-hw * tail, -hl],
    [-hw, -hl * 0.45], [-hw, hl * 0.1], [-hw * 0.96, hl * 0.62],
  ];
}

function box(cx: number, cy: number, w: number, d: number): Pt[] {
  return [[cx - w / 2, cy + d / 2], [cx + w / 2, cy + d / 2], [cx + w / 2, cy - d / 2], [cx - w / 2, cy - d / 2]];
}

function parts(icon: CarIconKey): Part[] {
  const s = SPECS[icon];
  const out: Part[] = [];
  const bodyW = s.width;
  out.push({ poly: round(hull(s.length, bodyW, s.nose, s.tail)), base: 0.2, top: s.height, role: "body" });
  if (s.cabin) {
    const y0 = -s.length / 2 + s.cabin.from * s.length;
    const y1 = -s.length / 2 + s.cabin.to * s.length;
    const w = bodyW * s.cabin.width;
    const mid = (y0 + y1) / 2;
    const d = y1 - y0;
    // A dark band for the windows, then a lighter roof slab set in a little so the band reads as glass.
    out.push({ poly: round(box(0, mid, w, d), 1), base: s.height, top: s.cabin.top - 0.18, role: "glass" });
    out.push({ poly: round(box(0, mid - 0.04, w * 0.8, d * 0.72), 1), base: s.cabin.top - 0.18, top: s.cabin.top, role: "roof" });
  }
  for (const [x, y] of [[-1, s.wheel.front], [1, s.wheel.front], [-1, s.wheel.rear], [1, s.wheel.rear]] as [number, number][]) {
    out.push({ poly: box((x * (s.wheel.track - s.wheel.w)) / 2 + (s.open ? x * 0.0 : 0), y, s.wheel.w, s.wheel.d), base: 0, top: s.wheel.h, role: "trim" });
  }
  if (s.wings?.front) out.push({ poly: box(0, s.wings.front.y, s.wings.front.w, 0.34), base: 0.12, top: 0.26, role: "trim" });
  if (s.wings?.rear) {
    out.push({ poly: box(0, s.wings.rear.y, s.wings.rear.w, 0.4), base: s.wings.rear.h - 0.12, top: s.wings.rear.h, role: "trim" });
    out.push({ poly: box(-s.wings.rear.w * 0.3, s.wings.rear.y, 0.1, 0.3), base: s.height, top: s.wings.rear.h - 0.12, role: "trim" });
    out.push({ poly: box(s.wings.rear.w * 0.3, s.wings.rear.y, 0.1, 0.3), base: s.height, top: s.wings.rear.h - 0.12, role: "trim" });
  }
  return out;
}

const PARTS = Object.fromEntries((Object.keys(SPECS) as CarIconKey[]).map((k) => [k, parts(k)])) as Record<CarIconKey, Part[]>;

export function carLength(icon: CarIconKey): number {
  return SPECS[icon].length;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = f(((n >> 16) & 255) * k);
  const g = f(((n >> 8) & 255) * k);
  const b = f((n & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export interface Car3D {
  id: string;
  lng: number;
  lat: number;
  heading: number;
  icon: CarIconKey;
  color: string;
  stale?: boolean;
}

// Metres per density-independent pixel at a zoom and latitude (512 pixel tiles).
export function metresPerPoint(zoom: number, lat: number): number {
  return (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

// Cars are drawn a fixed amount larger than life, and that never changes with zoom. A zoom-dependent size would have to be
// recomputed on every frame of a pinch and made cars balloon or pop; a fixed size just gets smaller as you zoom out, like
// everything else on the map. At about this size a car is roughly 60 points long at the following zoom.
export const CAR_SCALE = 3.4;
// Below this zoom a car is too small to read, so the map shows a coloured dot for it instead.
export const MIN_MODEL_ZOOM = 15.2;

export function carScale(): number {
  return CAR_SCALE;
}

export function carFeatures(cars: Car3D[]): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (const car of cars) {
    const k = carScale();
    const theta = (car.heading * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const mLng = 111320 * Math.cos((car.lat * Math.PI) / 180);
    for (const [i, part] of PARTS[car.icon].entries()) {
      const ring = part.poly.map(([x, y]) => {
        const east = (x * cos + y * sin) * k;
        const north = (-x * sin + y * cos) * k;
        return [car.lng + east / mLng, car.lat + north / 111320] as [number, number];
      });
      ring.push(ring[0]!);
      // Opacity cannot vary per shape in the map, so a car that has gone quiet is dimmed through its colours instead.
      const body = car.stale ? shade(car.color, 0.45) : car.color;
      const color = part.role === "body" ? body : part.role === "roof" ? shade(body, 1.12) : part.role === "glass" ? "#141a26" : "#0b0d12";
      features.push({
        type: "Feature",
        id: `${car.id}-${i}`,
        properties: { color, base: part.base * k, top: part.top * k, stale: car.stale ? 1 : 0 },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  }
  return features;
}
