import type { Place } from "@rdv/core";

export const LABEL_MIN = 3;
export const LABEL_MAX = 40;
export const NOTE_MAX = 140;
export const QUERY_MIN = 3;

export const labelError = (label: string) => {
  const length = label.trim().length;
  return length < LABEL_MIN || length > LABEL_MAX ? "pin_label_invalid" : null;
};

export const noteError = (note: string) => (note.trim().length > NOTE_MAX ? "pin_note_invalid" : null);

export function defaultLabel(place: Pick<Place, "name" | "address"> | null): string {
  const base = place?.name || place?.address || "Dropped pin";
  return base.length > LABEL_MAX ? base.slice(0, LABEL_MAX).trim() : base;
}

export const queryReady = (text: string) => text.trim().length >= QUERY_MIN;
