import type { CrewSummary, GeoPoint, MapPin, MemberPosition, Place } from "@rdv/core";
import { RDV_KIND } from "@rdv/core/places";
import { haversineMeters } from "@rdv/core/geo";

export type RdvKind = "meet" | "cruise" | "private_event";
export type Answer = "going" | "maybe" | "cant";
export type RdvStatus = "scheduled" | "cancelled";

export const DEFAULT_RADIUS_M = 150;
export const RADIUS_MIN = 50;
export const RADIUS_MAX = 500;
export const TITLE_MIN = 3;
export const TITLE_MAX = 60;
export const NOTE_MAX = 280;
export const DEFAULT_DURATION_MS = 3 * 3600000;
export const WINDOW_LEAD_MS = 3600000;
export const REMINDER_LEAD_MS = 3600000;
export const FRESH_FIX_MS = 120000;

export const KIND_LABELS: Record<RdvKind, string> = { meet: "Meet", cruise: "Cruise", private_event: "Private event" };
export const ANSWER_LABELS: Record<Answer, string> = { going: "Going", maybe: "Maybe", cant: "Can't" };

export interface Rdv {
  id: string;
  hostId: string | null;
  hostHandle: string | null;
  title: string;
  kind: RdvKind;
  areaName: string;
  startsAt: number;
  endsAt: number | null;
  endAt: number;
  radiusM: number;
  note: string | null;
  status: RdvStatus;
  crewIds: string[];
  place: { name: string; lat: number; lng: number } | null;
  going: number;
  maybe: number;
  cant: number;
  myAnswer: Answer | null;
  arrived: boolean;
}

export interface RdvRow {
  id: string;
  host_id: string | null;
  host_handle: string | null;
  title: string;
  kind: RdvKind;
  area_name: string;
  starts_at: string;
  ends_at: string | null;
  end_at: string;
  radius_m: number;
  note: string | null;
  status: RdvStatus;
  crew_ids: string[] | null;
  place: { name: string; lat: number; lng: number } | null;
  going: number;
  maybe: number;
  cant: number;
  my_answer: Answer | null;
  arrived: boolean;
}

export const rdvFromRow = (row: RdvRow): Rdv => ({
  id: row.id,
  hostId: row.host_id,
  hostHandle: row.host_handle,
  title: row.title,
  kind: row.kind,
  areaName: row.area_name,
  startsAt: Date.parse(row.starts_at),
  endsAt: row.ends_at ? Date.parse(row.ends_at) : null,
  endAt: Date.parse(row.end_at),
  radiusM: row.radius_m,
  note: row.note,
  status: row.status,
  crewIds: row.crew_ids ?? [],
  place: row.place,
  going: row.going,
  maybe: row.maybe,
  cant: row.cant,
  myAnswer: row.my_answer,
  arrived: row.arrived,
});

export const effectiveEnd = (startsAt: number, endsAt: number | null): number => endsAt ?? startsAt + DEFAULT_DURATION_MS;

export const hasEnded = (rdv: Pick<Rdv, "endAt">, now: number) => rdv.endAt <= now;

export const attendanceWindow = (rdv: Pick<Rdv, "startsAt" | "endAt">) => ({ from: rdv.startsAt - WINDOW_LEAD_MS, to: rdv.endAt });

export function inAttendanceWindow(rdv: Pick<Rdv, "startsAt" | "endAt">, now: number): boolean {
  const { from, to } = attendanceWindow(rdv);
  return now >= from && now <= to;
}

export const isHappening = (rdv: Pick<Rdv, "startsAt" | "endAt" | "status">, now: number) =>
  rdv.status === "scheduled" && now >= rdv.startsAt && now < rdv.endAt;

export const canAnswer = (rdv: Pick<Rdv, "endAt" | "status">, now: number) => rdv.status === "scheduled" && now < rdv.endAt;

export const insideRadius = (point: GeoPoint, place: GeoPoint, radiusM: number) => haversineMeters(point, place) <= radiusM;

export const canMarkHere = (rdv: Rdv, now: number) => rdv.status === "scheduled" && !!rdv.place && !rdv.arrived && inAttendanceWindow(rdv, now);

export const canEdit = (rdv: Rdv, userId: string | null, now: number) => !!userId && rdv.hostId === userId && rdv.status === "scheduled" && !hasEnded(rdv, now);

export const canCancel = (rdv: Rdv, userId: string | null, crews: Pick<CrewSummary, "id" | "role">[], now: number) =>
  !!userId &&
  rdv.status === "scheduled" &&
  !hasEnded(rdv, now) &&
  (rdv.hostId === userId || crews.some((c) => c.role === "owner" && rdv.crewIds.includes(c.id)));

export const byStart = (a: Rdv, b: Rdv) => a.startsAt - b.startsAt || a.id.localeCompare(b.id);

// Upcoming holds every RDV that has not ended (happening now included), soonest first. Past holds the rest, latest first.
export function splitPlans(rdvs: Rdv[], now: number): { upcoming: Rdv[]; past: Rdv[] } {
  const upcoming = rdvs.filter((r) => r.endAt > now).sort(byStart);
  const past = rdvs.filter((r) => r.endAt <= now).sort((a, b) => byStart(b, a));
  return { upcoming, past };
}

export const upcomingFor = (rdvs: Rdv[], crewId: string, now: number): Rdv[] => splitPlans(rdvs.filter((r) => r.crewIds.includes(crewId)), now).upcoming;

export const inCrews = (rdv: Pick<Rdv, "crewIds">, crewIds: string[]) => rdv.crewIds.some((id) => crewIds.includes(id));

// A scheduled RDV of the selected crews shows a pin until it ends. A private event has no place for someone who has not
// answered going or maybe, and so no pin.
export const showsPin = (rdv: Rdv, selected: string[], now: number) =>
  rdv.status === "scheduled" && rdv.endAt > now && !!rdv.place && inCrews(rdv, selected);

// The pin takes the tint of the first crew, in the order crews are listed, that the RDV shares with the selection.
export function pinColorKey(rdv: Pick<Rdv, "crewIds">, crews: Pick<CrewSummary, "id" | "styleIndex">[], selected: string[]): number {
  const shared = crews.filter((c) => selected.includes(c.id) && rdv.crewIds.includes(c.id));
  return shared.length ? Math.min(...shared.map((c) => c.styleIndex)) : 0;
}

export function toMapPin(rdv: Rdv, crews: Pick<CrewSummary, "id" | "styleIndex">[], selected: string[], now: number, onPress: () => void): MapPin | null {
  if (!showsPin(rdv, selected, now)) return null;
  return {
    id: rdv.id,
    lat: rdv.place!.lat,
    lng: rdv.place!.lng,
    label: rdv.title,
    kind: RDV_KIND,
    colorKey: pinColorKey(rdv, crews, selected),
    live: isHappening(rdv, now),
    onPress,
  };
}

export const placeOfRdv = (rdv: Rdv): Place | null =>
  rdv.place ? { name: rdv.place.name, kind: "RDV", address: null, lat: rdv.place.lat, lng: rdv.place.lng } : null;

// Whether the device should make the one record_arrival call for a live member: live to a crew the RDV is for, inside the
// radius, inside the window, and not already arrived.
export function shouldReportArrival(rdv: Rdv, position: Pick<MemberPosition, "lat" | "lng" | "crewIds" | "ts">, now: number): boolean {
  if (rdv.status !== "scheduled" || !rdv.place || rdv.arrived) return false;
  if (!inAttendanceWindow(rdv, now)) return false;
  if (now - position.ts > FRESH_FIX_MS) return false;
  if (!position.crewIds.some((id) => rdv.crewIds.includes(id))) return false;
  return insideRadius(position, rdv.place, rdv.radiusM);
}

export interface Reminder {
  key: string;
  at: number;
  title: string;
  body: string;
}

// One reminder an hour before the start for an RDV the person answered going or maybe. Closer than that it fires at the
// start. Nothing for a cancelled or ended RDV, or when the answer is cant or none.
export function reminderFor(rdv: Rdv, now: number, formatTime: (ms: number) => string): Reminder | null {
  if (rdv.status !== "scheduled" || (rdv.myAnswer !== "going" && rdv.myAnswer !== "maybe")) return null;
  let at = rdv.startsAt - REMINDER_LEAD_MS;
  if (at <= now) at = rdv.startsAt;
  if (at <= now) return null;
  const where = rdv.place ? rdv.place.name : rdv.areaName;
  return { key: `rdv-${rdv.id}`, at, title: rdv.title, body: `${formatTime(rdv.startsAt)}  ·  ${where}` };
}

export const remindersFor = (rdvs: Rdv[], now: number, formatTime: (ms: number) => string): Reminder[] =>
  rdvs.flatMap((rdv) => reminderFor(rdv, now, formatTime) ?? []);

export function diffReminders(desired: Reminder[], existing: { key: string; at: number; title?: string; body?: string }[]): { add: Reminder[]; remove: string[] } {
  const have = new Map(existing.map((e) => [e.key, e]));
  const want = new Map(desired.map((d) => [d.key, d]));
  const add = desired.filter((d) => {
    const e = have.get(d.key);
    return !e || e.at !== d.at || e.title !== d.title || e.body !== d.body;
  });
  const remove = existing.filter((e) => !want.has(e.key) || add.some((a) => a.key === e.key)).map((e) => e.key);
  return { add, remove };
}

// A short, coarse name for a private event: the locality after the street in an address.
export function areaName(place: Pick<Place, "address">): string {
  const parts = (place.address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1]!.slice(0, 60) : "Nearby";
}
