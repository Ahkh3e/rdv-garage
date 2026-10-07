import { crewStyle, type MapPin } from "@rdv/core";

export function pinFeatures(pins: MapPin[]): GeoJSON.Feature<GeoJSON.Point>[] {
  return pins.map((pin) => ({
    type: "Feature",
    id: pin.id,
    geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
    properties: { id: pin.id, label: pin.label, kind: pin.kind, color: crewStyle(pin.colorKey).tint, live: pin.live === true },
  }));
}

export const PULSE_STEPS = 8;
export const PULSE_CYCLE_MS = 2000;
export const PULSE_STILL = 0.4;

export const pulseStep = (elapsedMs: number): number => Math.floor(((elapsedMs % PULSE_CYCLE_MS) / PULSE_CYCLE_MS) * PULSE_STEPS);

export const pulsePhase = (step: number): number => step / PULSE_STEPS;
