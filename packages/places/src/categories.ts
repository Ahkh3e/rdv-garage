import type { GeoPoint, Place, Poi } from "@rdv/core";
import { formatDistance, haversineMeters } from "@rdv/core/geo";

export { formatDistance };

export type CategoryId = "fuel" | "food" | "coffee" | "parking" | "carwash" | "ev";

export const CATEGORIES: { id: CategoryId; label: string; matches: string[] }[] = [
  { id: "fuel", label: "Fuel", matches: ["fuel", "gas", "gas_station"] },
  { id: "food", label: "Food", matches: ["restaurant", "fast_food", "food_court"] },
  { id: "coffee", label: "Coffee", matches: ["cafe", "coffee", "coffee_shop"] },
  { id: "parking", label: "Parking", matches: ["parking"] },
  { id: "carwash", label: "Car wash", matches: ["car_wash"] },
  { id: "ev", label: "EV charging", matches: ["charging_station"] },
];

export function categoryOf(poi: Pick<Poi, "cls" | "subclass">): CategoryId | null {
  for (const category of CATEGORIES) {
    if (category.matches.includes(poi.cls) || (poi.subclass !== null && category.matches.includes(poi.subclass))) return category.id;
  }
  return null;
}

export interface NearbyResult {
  place: Place;
  meters: number;
}

export const NEARBY_LIMIT = 20;

export function nearby(pois: Poi[], category: CategoryId, center: GeoPoint, limit = NEARBY_LIMIT): NearbyResult[] {
  const label = CATEGORIES.find((c) => c.id === category)!.label;
  return pois
    .filter((poi) => categoryOf(poi) === category)
    .map((poi) => ({ place: { name: poi.name, kind: label, address: null, lat: poi.lat, lng: poi.lng }, meters: haversineMeters(center, poi) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}
