import type { GeoPoint, Geocoder, Place } from "@rdv/core";
import { coarseBias } from "./bias";

type Invoke = (body: { text: string; bias: GeoPoint | null }) => Promise<unknown>;

export function createGeocoder(invoke: Invoke): Geocoder {
  return {
    async search(text, bias) {
      const reply = (await invoke({ text, bias: coarseBias(bias) })) as { results?: Place[] };
      return Array.isArray(reply?.results) ? reply.results : [];
    },
  };
}
