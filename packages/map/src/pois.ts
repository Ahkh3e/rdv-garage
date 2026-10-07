import type { Poi } from "@rdv/core";

export function poisFromFeatures(features: GeoJSON.Feature[]): Poi[] {
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const feature of features) {
    if (feature.geometry?.type !== "Point") continue;
    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties ?? {};
    const name = props["name:en"] ?? props.name;
    if (typeof lng !== "number" || typeof lat !== "number" || typeof name !== "string" || !name) continue;
    const cls = typeof props.class === "string" ? props.class : "";
    const subclass = typeof props.subclass === "string" ? props.subclass : null;
    const key = `${name}|${cls}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat, lng, cls, subclass });
  }
  return out;
}
