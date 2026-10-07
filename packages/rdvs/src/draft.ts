import type { Place } from "@rdv/core";
import { DEFAULT_RADIUS_M, NOTE_MAX, RADIUS_MAX, RADIUS_MIN, TITLE_MAX, TITLE_MIN, areaName, type Rdv, type RdvKind } from "./model";

export interface Draft {
  title: string;
  kind: RdvKind;
  place: Place | null;
  areaName: string | null;
  startsAt: number | null;
  durationMin: number | null;
  note: string;
  crewIds: string[];
  radiusM: number;
}

export const STEP_MIN = 15;
export const DURATION_STEP_MIN = 30;
export const DURATION_MIN = 30;
export const DURATION_MAX = 24 * 60;
export const DAY_OPTIONS = 14;
export const RADIUS_STEP = 50;

export const emptyDraft = (place: Place | null, crewIds: string[], now: number): Draft => ({
  title: "",
  kind: "meet",
  place,
  areaName: null,
  startsAt: defaultStart(now),
  durationMin: null,
  note: "",
  crewIds,
  radiusM: DEFAULT_RADIUS_M,
});

export const draftFromRdv = (rdv: Rdv): Draft => ({
  title: rdv.title,
  kind: rdv.kind,
  place: rdv.place ? { name: rdv.place.name, kind: "RDV", address: null, lat: rdv.place.lat, lng: rdv.place.lng } : null,
  areaName: rdv.areaName,
  startsAt: rdv.startsAt,
  durationMin: rdv.endsAt ? Math.round((rdv.endsAt - rdv.startsAt) / 60000) : null,
  note: rdv.note ?? "",
  crewIds: rdv.crewIds,
  radiusM: rdv.radiusM,
});

// The next quarter hour that is at least a quarter hour away.
export function defaultStart(now: number): number {
  const d = new Date(now + STEP_MIN * 60000);
  d.setSeconds(0, 0);
  const minutes = d.getMinutes();
  const rounded = Math.ceil(minutes / STEP_MIN) * STEP_MIN;
  d.setMinutes(rounded);
  return d.getTime();
}

export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const dayOptions = (now: number, count = DAY_OPTIONS): number[] => {
  const first = new Date(startOfDay(now));
  return Array.from({ length: count }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i).getTime());
};

export const minutesOfDay = (ms: number): number => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

export function withDay(ms: number, dayStart: number): number {
  const day = new Date(dayStart);
  const time = new Date(ms);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes()).getTime();
}

// Moves the whole timestamp by steps, so stepping past midnight changes the day.
export function withTimeShift(ms: number, deltaMin: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() + deltaMin).getTime();
}

export const stepRadius = (radius: number, direction: 1 | -1): number => Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, radius + direction * RADIUS_STEP));

export const stepDuration = (minutes: number | null, direction: 1 | -1): number | null => {
  if (minutes === null) return direction > 0 ? 120 : null;
  const next = minutes + direction * DURATION_STEP_MIN;
  if (next < DURATION_MIN) return null;
  return Math.min(DURATION_MAX, next);
};

export const endOf = (draft: Pick<Draft, "startsAt" | "durationMin">): number | null =>
  draft.startsAt !== null && draft.durationMin !== null ? draft.startsAt + draft.durationMin * 60000 : null;

export type DraftError =
  | "rdv_title_invalid"
  | "rdv_kind_invalid"
  | "rdv_place_invalid"
  | "rdv_time_invalid"
  | "rdv_in_past"
  | "rdv_end_invalid"
  | "rdv_note_invalid"
  | "rdv_radius_invalid"
  | "rdv_crew_required";

// The first problem with a draft, as the error code the server would give. `unchangedStart` lets the host edit an RDV
// that has already started without moving its start.
export function draftError(draft: Draft, now: number, unchangedStart: number | null = null): DraftError | null {
  const title = draft.title.trim().length;
  if (title < TITLE_MIN || title > TITLE_MAX) return "rdv_title_invalid";
  if (!draft.place) return "rdv_place_invalid";
  if (draft.startsAt === null) return "rdv_time_invalid";
  if (draft.startsAt < now && !(unchangedStart !== null && Math.abs(draft.startsAt - unchangedStart) < 1000)) return "rdv_in_past";
  if (draft.durationMin !== null && draft.durationMin <= 0) return "rdv_end_invalid";
  if (draft.note.trim().length > NOTE_MAX) return "rdv_note_invalid";
  if (draft.radiusM < RADIUS_MIN || draft.radiusM > RADIUS_MAX) return "rdv_radius_invalid";
  if (draft.crewIds.length === 0) return "rdv_crew_required";
  return null;
}

export function toArgs(draft: Draft): Record<string, unknown> {
  const end = endOf(draft);
  return {
    p_title: draft.title.trim(),
    p_kind: draft.kind,
    p_place_name: draft.place!.name.trim().slice(0, 80) || "Meet point",
    p_lat: draft.place!.lat,
    p_lng: draft.place!.lng,
    p_area_name: draft.areaName ?? areaName(draft.place!),
    p_starts_at: new Date(draft.startsAt!).toISOString(),
    p_ends_at: end === null ? null : new Date(end).toISOString(),
    p_note: draft.note.trim() || null,
    p_crew_ids: draft.crewIds,
    p_radius_m: draft.radiusM,
  };
}
