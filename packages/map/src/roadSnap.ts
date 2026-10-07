// Snaps positions onto the road lines the map has already loaded, so trails run along real roads. This works on the
// geometry on the phone: nothing is sent anywhere, and it only has roads for the area the person is looking at.
export interface LngLat {
  lng: number;
  lat: number;
}

export interface RoadLine {
  id: number;
  pts: LngLat[];
}

export interface Snap extends LngLat {
  line: number;
  seg: number;
  t: number;
  dist: number;
}

const M_LAT = 111320;
const CELL_LAT = 0.0006;
const CELL_LNG = 0.0009;

export function linesFromFeatures(features: GeoJSON.Feature[]): RoadLine[] {
  const lines: RoadLine[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const coords of parts) {
      if (coords.length < 2) continue;
      lines.push({ id: lines.length, pts: coords.map((c) => ({ lng: c[0]!, lat: c[1]! })) });
    }
  }
  return lines;
}

export class RoadIndex {
  private grid = new Map<string, [number, number][]>();
  constructor(readonly lines: RoadLine[]) {
    for (const line of lines) {
      for (let s = 0; s < line.pts.length - 1; s++) {
        const a = line.pts[s]!;
        const b = line.pts[s + 1]!;
        const x0 = Math.floor(Math.min(a.lng, b.lng) / CELL_LNG);
        const x1 = Math.floor(Math.max(a.lng, b.lng) / CELL_LNG);
        const y0 = Math.floor(Math.min(a.lat, b.lat) / CELL_LAT);
        const y1 = Math.floor(Math.max(a.lat, b.lat) / CELL_LAT);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const key = `${x},${y}`;
            const bucket = this.grid.get(key);
            if (bucket) bucket.push([line.id, s]);
            else this.grid.set(key, [[line.id, s]]);
          }
        }
      }
    }
  }

  get size(): number {
    return this.lines.length;
  }

  // Nearest road within maxM metres. With a direction of travel, roads running another way are less likely, so a
  // parallel street or a crossing road does not steal the point.
  snap(p: LngLat, heading: number | null = null, maxM = 25, preferLine: number | null = null): Snap | null {
    const cx = Math.floor(p.lng / CELL_LNG);
    const cy = Math.floor(p.lat / CELL_LAT);
    const kx = Math.cos((p.lat * Math.PI) / 180) * M_LAT;
    let best: Snap | null = null;
    let bestCost = Infinity;
    const seen = new Set<number>();
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const [id, s] of this.grid.get(`${x},${y}`) ?? []) {
          const key = id * 100000 + s;
          if (seen.has(key)) continue;
          seen.add(key);
          const pts = this.lines[id]!.pts;
          const a = pts[s]!;
          const b = pts[s + 1]!;
          const ax = (a.lng - p.lng) * kx;
          const ay = (a.lat - p.lat) * M_LAT;
          const bx = (b.lng - p.lng) * kx;
          const by = (b.lat - p.lat) * M_LAT;
          const dx = bx - ax;
          const dy = by - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
          const px = ax + dx * t;
          const py = ay + dy * t;
          const dist = Math.hypot(px, py);
          if (dist > maxM) continue;
          let cost = dist;
          if (heading !== null && len2 > 0) {
            const road = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180;
            const diff = Math.abs(road - (heading % 180));
            if (Math.min(diff, 180 - diff) > 60) cost += 18;
          }
          // Staying on the road you were on avoids hopping between parallel streets or at crossings.
          if (preferLine !== null && id === preferLine) cost -= 10;
          if (cost < bestCost) {
            bestCost = cost;
            best = { lng: p.lng + px / kx, lat: p.lat + py / M_LAT, line: id, seg: s, t, dist };
          }
        }
      }
    }
    return best;
  }

  // The vertices of the road between two snapped points on the same line, so the trail follows bends instead of cutting them.
  between(a: Snap, b: Snap): LngLat[] | null {
    if (a.line !== b.line) return null;
    const pts = this.lines[a.line]?.pts;
    if (!pts) return null;
    const forward = a.seg < b.seg || (a.seg === b.seg && a.t <= b.t);
    const path: LngLat[] = [];
    if (forward) for (let i = a.seg + 1; i <= b.seg; i++) path.push(pts[i]!);
    else for (let i = a.seg; i > b.seg; i--) path.push(pts[i]!);
    let walked = 0;
    let prev: LngLat = a;
    for (const v of [...path, b]) {
      walked += Math.hypot((v.lng - prev.lng) * Math.cos((v.lat * Math.PI) / 180) * M_LAT, (v.lat - prev.lat) * M_LAT);
      prev = v;
    }
    const straight = Math.hypot((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180) * M_LAT, (b.lat - a.lat) * M_LAT);
    // A road that loops far around is not the way between two nearby fixes.
    return walked > Math.max(60, straight * 2.5) ? null : path;
  }
}
