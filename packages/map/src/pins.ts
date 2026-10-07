import { crewStyle, type MapPin } from "@rdv/core";

export function pinFeatures(pins: MapPin[]): GeoJSON.Feature<GeoJSON.Point>[] {
  return pins.map((pin) => ({
    type: "Feature",
    id: pin.id,
    geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
    properties: { id: pin.id, label: pin.label, kind: pin.kind, color: crewStyle(pin.colorKey).tint },
  }));
}
