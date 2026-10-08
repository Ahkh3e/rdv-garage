import type { CrewSummary, MapPin, Place } from "@rdv/core";
import { PIN_KIND, PLACE_KIND } from "@rdv/core/places";

export interface Pin {
  id: string;
  dropperId: string;
  dropperHandle: string;
  label: string;
  note: string | null;
  address: string | null;
  lat: number;
  lng: number;
  expiresAt: number;
  crewIds: string[];
}

export interface PinRow {
  id: string;
  dropper_id: string;
  dropper_handle: string;
  label: string;
  note: string | null;
  address: string | null;
  lat: number;
  lng: number;
  expires_at: string;
  crew_ids: string[] | null;
}

export const pinFromRow = (row: PinRow): Pin => ({
  id: row.id,
  dropperId: row.dropper_id,
  dropperHandle: row.dropper_handle,
  label: row.label,
  note: row.note,
  address: row.address,
  lat: row.lat,
  lng: row.lng,
  expiresAt: Date.parse(row.expires_at),
  crewIds: row.crew_ids ?? [],
});

export const unexpired = (pins: Pin[], now: number) => pins.filter((pin) => pin.expiresAt > now);

export const canRemove = (pin: Pin, userId: string, crews: Pick<CrewSummary, "id" | "role">[]) =>
  pin.dropperId === userId || crews.some((crew) => crew.role !== "member" && pin.crewIds.includes(crew.id));

export const placeOfPin = (pin: Pin): Place => ({ name: pin.label, kind: "Pin", address: pin.address, lat: pin.lat, lng: pin.lng });

// The tint comes from the first listed crew the person still has.
export function toMapPin(pin: Pin, crews: Pick<CrewSummary, "id" | "styleIndex">[], onPress: () => void): MapPin {
  const crew = crews.find((c) => pin.crewIds.includes(c.id));
  return { id: `pin-${pin.id}`, lat: pin.lat, lng: pin.lng, label: pin.label, kind: PIN_KIND, colorKey: crew?.styleIndex ?? 0, onPress };
}

export const toPlacePin = (id: string, place: Place, onPress: () => void): MapPin => ({
  id: `place-${id}`,
  lat: place.lat,
  lng: place.lng,
  label: place.name,
  kind: PLACE_KIND,
  colorKey: 0,
  onPress,
});

export const expiresIn = (pin: Pin, now: number) => {
  const minutes = Math.max(0, Math.round((pin.expiresAt - now) / 60000));
  return minutes >= 60 ? `${Math.round(minutes / 60)} h left` : `${minutes} min left`;
};
