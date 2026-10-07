import { describe, expect, it } from "vitest";
import { dayOptions, defaultStart, draftError, emptyDraft, endOf, minutesOfDay, startOfDay, stepDuration, stepRadius, toArgs, withDay, withTimeShift, type Draft } from "./draft";
import { formatDay, formatDuration, formatTime, formatWhen } from "./format";
import {
  areaName, attendanceWindow, canAnswer, canCancel, canEdit, canMarkHere, diffReminders, effectiveEnd, inAttendanceWindow, insideRadius, isHappening,
  pinColorKey, reminderFor, remindersFor, shouldReportArrival, showsPin, splitPlans, toMapPin, upcomingFor, type Rdv,
} from "./model";

const H = 3600000;
const NOW = new Date(2026, 5, 10, 18, 7).getTime();
const base: Rdv = {
  id: "r1", hostId: "host", hostHandle: "host", title: "Sunday meet", kind: "meet", areaName: "Waterfront",
  startsAt: NOW + 5 * H, endsAt: null, endAt: NOW + 8 * H, radiusM: 150, note: null, status: "scheduled", crewIds: ["c1"],
  place: { name: "Harbour lot", lat: 43.65, lng: -79.38 }, going: 0, maybe: 0, cant: 0, myAnswer: null, arrived: false,
};
const rdv = (over: Partial<Rdv> = {}): Rdv => ({ ...base, ...over });

describe("effective end and window", () => {
  it("uses the end time, or three hours after the start", () => {
    expect(effectiveEnd(1000, null)).toBe(1000 + 3 * H);
    expect(effectiveEnd(1000, 5000)).toBe(5000);
  });

  it("opens an hour before the start and closes at the end", () => {
    const r = rdv({ startsAt: NOW, endAt: NOW + 3 * H });
    expect(attendanceWindow(r)).toEqual({ from: NOW - H, to: NOW + 3 * H });
    expect(inAttendanceWindow(r, NOW - H - 1)).toBe(false);
    expect(inAttendanceWindow(r, NOW - H)).toBe(true);
    expect(inAttendanceWindow(r, NOW + 3 * H)).toBe(true);
    expect(inAttendanceWindow(r, NOW + 3 * H + 1)).toBe(false);
  });

  it("is happening from the start until the end, and not when cancelled", () => {
    const r = rdv({ startsAt: NOW - H, endAt: NOW + H });
    expect(isHappening(r, NOW)).toBe(true);
    expect(isHappening(r, NOW - 2 * H)).toBe(false);
    expect(isHappening(r, NOW + H)).toBe(false);
    expect(isHappening({ ...r, status: "cancelled" }, NOW)).toBe(false);
  });

  it("allows answers until it ends, not when cancelled", () => {
    expect(canAnswer(rdv(), NOW)).toBe(true);
    expect(canAnswer(rdv({ endAt: NOW }), NOW)).toBe(false);
    expect(canAnswer(rdv({ status: "cancelled" }), NOW)).toBe(false);
  });
});

describe("radius", () => {
  const place = { lat: 43.65, lng: -79.38 };
  it("compares the distance with the radius", () => {
    expect(insideRadius(place, place, 50)).toBe(true);
    expect(insideRadius({ lat: 43.6505, lng: -79.38 }, place, 100)).toBe(true);
    expect(insideRadius({ lat: 43.6505, lng: -79.38 }, place, 50)).toBe(false);
    expect(insideRadius({ lat: 43.66, lng: -79.38 }, place, 500)).toBe(false);
  });
});

describe("arrival rules", () => {
  const at = { lat: 43.65, lng: -79.38, crewIds: ["c1"], ts: NOW };
  const open = rdv({ startsAt: NOW - 10 * 60000, endAt: NOW + 2 * H });

  it("lets the device report a live member inside the radius during the window", () => {
    expect(shouldReportArrival(open, at, NOW)).toBe(true);
    expect(shouldReportArrival(rdv({ startsAt: NOW + 30 * 60000, endAt: NOW + 4 * H }), at, NOW)).toBe(true);
  });

  it("does not report outside the window, outside the radius, when already arrived or when cancelled", () => {
    expect(shouldReportArrival(rdv({ startsAt: NOW + 2 * H, endAt: NOW + 5 * H }), at, NOW)).toBe(false);
    expect(shouldReportArrival(rdv({ startsAt: NOW - 5 * H, endAt: NOW - 2 * H }), at, NOW)).toBe(false);
    expect(shouldReportArrival(open, { ...at, lat: 43.66 }, NOW)).toBe(false);
    expect(shouldReportArrival({ ...open, arrived: true }, at, NOW)).toBe(false);
    expect(shouldReportArrival({ ...open, status: "cancelled" }, at, NOW)).toBe(false);
    expect(shouldReportArrival({ ...open, place: null }, at, NOW)).toBe(false);
  });

  it("needs the member to be live to a crew the RDV is for and the reading to be fresh", () => {
    expect(shouldReportArrival(open, { ...at, crewIds: ["other"] }, NOW)).toBe(false);
    expect(shouldReportArrival(open, { ...at, ts: NOW - 5 * 60000 }, NOW)).toBe(false);
  });

  it("offers I'm here only inside the window, with a visible place, before arrival", () => {
    expect(canMarkHere(open, NOW)).toBe(true);
    expect(canMarkHere(rdv(), NOW)).toBe(false);
    expect(canMarkHere({ ...open, arrived: true }, NOW)).toBe(false);
    expect(canMarkHere({ ...open, place: null }, NOW)).toBe(false);
  });
});

describe("ordering", () => {
  it("lists upcoming soonest first, happening now included, and past latest first", () => {
    const a = rdv({ id: "a", startsAt: NOW + 10 * H, endAt: NOW + 13 * H });
    const b = rdv({ id: "b", startsAt: NOW + 2 * H, endAt: NOW + 5 * H });
    const now = rdv({ id: "now", startsAt: NOW - H, endAt: NOW + H });
    const p1 = rdv({ id: "p1", startsAt: NOW - 30 * H, endAt: NOW - 27 * H });
    const p2 = rdv({ id: "p2", startsAt: NOW - 10 * H, endAt: NOW - 7 * H });
    const { upcoming, past } = splitPlans([p1, a, p2, b, now], NOW);
    expect(upcoming.map((r) => r.id)).toEqual(["now", "b", "a"]);
    expect(past.map((r) => r.id)).toEqual(["p2", "p1"]);
  });

  it("breaks ties by id", () => {
    const { upcoming } = splitPlans([rdv({ id: "b" }), rdv({ id: "a" })], NOW);
    expect(upcoming.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("upcomingFor", () => {
  it("lists a crew's RDVs that have not ended, soonest first, across multi-crew RDVs", () => {
    const rows = [
      rdv({ id: "a", startsAt: NOW + 2 * H, crewIds: ["c1", "c2"] }),
      rdv({ id: "b", startsAt: NOW + H, crewIds: ["c1"] }),
      rdv({ id: "other", crewIds: ["c2"] }),
      rdv({ id: "old", startsAt: NOW - 9 * H, endAt: NOW - 6 * H, crewIds: ["c1"] }),
    ];
    expect(upcomingFor(rows, "c1", NOW).map((r) => r.id)).toEqual(["b", "a"]);
    expect(upcomingFor(rows, "c3", NOW)).toEqual([]);
  });
});

describe("permissions", () => {
  const crews = [{ id: "c1", role: "owner" as const }, { id: "c2", role: "member" as const }];
  it("lets the host edit and the host or a crew owner cancel, until it ends", () => {
    expect(canEdit(rdv(), "host", NOW)).toBe(true);
    expect(canEdit(rdv(), "other", NOW)).toBe(false);
    expect(canEdit(rdv({ status: "cancelled" }), "host", NOW)).toBe(false);
    expect(canCancel(rdv(), "host", [], NOW)).toBe(true);
    expect(canCancel(rdv(), "other", crews, NOW)).toBe(true);
    expect(canCancel(rdv({ crewIds: ["c2"] }), "other", crews, NOW)).toBe(false);
    expect(canCancel(rdv({ endAt: NOW - 1 }), "host", crews, NOW)).toBe(false);
  });
});

describe("map pins", () => {
  const crews = [{ id: "c1", styleIndex: 0 }, { id: "c2", styleIndex: 2 }, { id: "c3", styleIndex: 4 }];
  it("pins a scheduled RDV of a selected crew until it ends", () => {
    expect(showsPin(rdv(), ["c1"], NOW)).toBe(true);
    expect(showsPin(rdv(), ["c2"], NOW)).toBe(false);
    expect(showsPin(rdv({ endAt: NOW }), ["c1"], NOW)).toBe(false);
  });

  it("has no pin when cancelled or when the place is hidden", () => {
    expect(showsPin(rdv({ status: "cancelled" }), ["c1"], NOW)).toBe(false);
    expect(showsPin(rdv({ kind: "private_event", place: null }), ["c1"], NOW)).toBe(false);
  });

  it("takes the tint of the first shared selected crew", () => {
    expect(pinColorKey(rdv({ crewIds: ["c3", "c2"] }), crews, ["c2", "c3"])).toBe(2);
    expect(pinColorKey(rdv({ crewIds: ["c3", "c2"] }), crews, ["c3"])).toBe(4);
  });

  it("builds an rdv pin with the Live badge while happening", () => {
    const pin = toMapPin(rdv({ startsAt: NOW - H, endAt: NOW + H }), crews, ["c1"], NOW, () => undefined);
    expect(pin).toMatchObject({ id: "r1", kind: "rdv", label: "Sunday meet", lat: 43.65, lng: -79.38, colorKey: 0, live: true });
    expect(toMapPin(rdv(), crews, ["c1"], NOW, () => undefined)?.live).toBe(false);
    expect(toMapPin(rdv({ status: "cancelled" }), crews, ["c1"], NOW, () => undefined)).toBeNull();
  });
});

describe("reminders", () => {
  const fmt = (ms: number) => `t${ms}`;
  it("reminds an hour before the start for going and maybe", () => {
    const r = reminderFor(rdv({ myAnswer: "going" }), NOW, fmt)!;
    expect(r).toMatchObject({ key: "rdv-r1", at: base.startsAt - H, title: "Sunday meet" });
    expect(r.body).toContain("Harbour lot");
    expect(reminderFor(rdv({ myAnswer: "maybe" }), NOW, fmt)).not.toBeNull();
  });

  it("fires at the start when less than an hour remains, and not after it", () => {
    expect(reminderFor(rdv({ myAnswer: "going", startsAt: NOW + 30 * 60000 }), NOW, fmt)!.at).toBe(NOW + 30 * 60000);
    expect(reminderFor(rdv({ myAnswer: "going", startsAt: NOW - 1 }), NOW, fmt)).toBeNull();
  });

  it("has none for cant, no answer or a cancelled RDV", () => {
    expect(reminderFor(rdv({ myAnswer: "cant" }), NOW, fmt)).toBeNull();
    expect(reminderFor(rdv(), NOW, fmt)).toBeNull();
    expect(reminderFor(rdv({ myAnswer: "going", status: "cancelled" }), NOW, fmt)).toBeNull();
  });

  it("names the area, not the place, when the place is hidden", () => {
    const r = reminderFor(rdv({ myAnswer: "maybe", place: null, kind: "private_event" }), NOW, fmt)!;
    expect(r.body).toContain("Waterfront");
  });

  it("collects reminders and diffs them against what is scheduled", () => {
    const wanted = remindersFor([rdv({ id: "a", myAnswer: "going" }), rdv({ id: "b" }), rdv({ id: "c", myAnswer: "maybe" })], NOW, fmt);
    expect(wanted.map((w) => w.key)).toEqual(["rdv-a", "rdv-c"]);
    const existing = [
      { key: "rdv-a", at: wanted[0]!.at, title: wanted[0]!.title, body: wanted[0]!.body },
      { key: "rdv-c", at: wanted[1]!.at + 1, title: wanted[1]!.title, body: wanted[1]!.body },
      { key: "rdv-gone", at: 1 },
    ];
    const { add, remove } = diffReminders(wanted, existing);
    expect(add.map((a) => a.key)).toEqual(["rdv-c"]);
    expect(remove.sort()).toEqual(["rdv-c", "rdv-gone"]);
  });
});

describe("area name", () => {
  it("takes the locality after the street", () => {
    expect(areaName({ address: "10 Queen St, Toronto, Ontario" })).toBe("Toronto");
    expect(areaName({ address: "Harbour lot" })).toBe("Nearby");
    expect(areaName({ address: null })).toBe("Nearby");
  });
});

describe("draft validation", () => {
  const place = { name: "Harbour lot", kind: "Park", address: "1 Main St, Toronto", lat: 43.65, lng: -79.38 };
  const good: Draft = { title: "Sunday meet", kind: "meet", place, startsAt: NOW + H, durationMin: null, note: "", crewIds: ["c1"], radiusM: 150 };

  it("accepts a good draft", () => {
    expect(draftError(good, NOW)).toBeNull();
  });

  it("checks the title length", () => {
    expect(draftError({ ...good, title: "ab" }, NOW)).toBe("rdv_title_invalid");
    expect(draftError({ ...good, title: "  ab  " }, NOW)).toBe("rdv_title_invalid");
    expect(draftError({ ...good, title: "x".repeat(60) }, NOW)).toBeNull();
    expect(draftError({ ...good, title: "x".repeat(61) }, NOW)).toBe("rdv_title_invalid");
  });

  it("needs a place, a crew and a start not in the past", () => {
    expect(draftError({ ...good, place: null }, NOW)).toBe("rdv_place_invalid");
    expect(draftError({ ...good, crewIds: [] }, NOW)).toBe("rdv_crew_required");
    expect(draftError({ ...good, startsAt: NOW - 1 }, NOW)).toBe("rdv_in_past");
    expect(draftError({ ...good, startsAt: null }, NOW)).toBe("rdv_time_invalid");
  });

  it("lets an edit keep a start that has already passed", () => {
    expect(draftError({ ...good, startsAt: NOW - H }, NOW, NOW - H)).toBeNull();
    expect(draftError({ ...good, startsAt: NOW - H }, NOW, NOW - 2 * H)).toBe("rdv_in_past");
  });

  it("checks the note and the radius", () => {
    expect(draftError({ ...good, note: "n".repeat(280) }, NOW)).toBeNull();
    expect(draftError({ ...good, note: "n".repeat(281) }, NOW)).toBe("rdv_note_invalid");
    expect(draftError({ ...good, radiusM: 49 }, NOW)).toBe("rdv_radius_invalid");
    expect(draftError({ ...good, radiusM: 501 }, NOW)).toBe("rdv_radius_invalid");
    expect(draftError({ ...good, radiusM: 50 }, NOW)).toBeNull();
    expect(draftError({ ...good, radiusM: 500 }, NOW)).toBeNull();
  });

  it("builds the call arguments with an area name and the optional end", () => {
    const args = toArgs({ ...good, title: " Sunday meet ", durationMin: 120, note: " hi " });
    expect(args).toMatchObject({ p_title: "Sunday meet", p_kind: "meet", p_area_name: "Toronto", p_note: "hi", p_radius_m: 150, p_crew_ids: ["c1"] });
    expect(new Date(args.p_ends_at as string).getTime() - new Date(args.p_starts_at as string).getTime()).toBe(2 * H);
    expect(toArgs(good).p_ends_at).toBeNull();
    expect(toArgs({ ...good, note: "  " }).p_note).toBeNull();
  });
});

describe("draft helpers", () => {
  it("starts at the next quarter hour at least a quarter hour away", () => {
    expect(new Date(defaultStart(new Date(2026, 5, 10, 18, 7).getTime())).getMinutes()).toBe(30);
    expect(defaultStart(new Date(2026, 5, 10, 18, 0, 0).getTime())).toBe(new Date(2026, 5, 10, 18, 15).getTime());
    expect(defaultStart(new Date(2026, 5, 10, 23, 50).getTime())).toBe(new Date(2026, 5, 11, 0, 15).getTime());
  });

  it("builds the draft with defaults", () => {
    const draft = emptyDraft(null, ["c1"], NOW);
    expect(draft).toMatchObject({ kind: "meet", radiusM: 150, durationMin: null, crewIds: ["c1"], place: null });
    expect(draft.startsAt).toBeGreaterThan(NOW);
  });

  it("offers days from today and moves the day without changing the time", () => {
    const days = dayOptions(NOW, 3);
    expect(days).toEqual([new Date(2026, 5, 10).getTime(), new Date(2026, 5, 11).getTime(), new Date(2026, 5, 12).getTime()]);
    expect(startOfDay(NOW)).toBe(days[0]);
    const moved = withDay(new Date(2026, 5, 10, 19, 30).getTime(), days[2]!);
    expect(moved).toBe(new Date(2026, 5, 12, 19, 30).getTime());
  });

  it("shifts the time of day within the day and wraps", () => {
    const t = new Date(2026, 5, 10, 23, 45).getTime();
    expect(minutesOfDay(withTimeShift(t, 15))).toBe(0);
    expect(new Date(withTimeShift(t, 15)).getDate()).toBe(10);
    expect(minutesOfDay(withTimeShift(new Date(2026, 5, 10, 0, 0).getTime(), -15))).toBe(23 * 60 + 45);
  });

  it("steps radius within 50 to 500 and duration from none to a day", () => {
    expect(stepRadius(150, 1)).toBe(200);
    expect(stepRadius(50, -1)).toBe(50);
    expect(stepRadius(500, 1)).toBe(500);
    expect(stepDuration(null, 1)).toBe(120);
    expect(stepDuration(null, -1)).toBeNull();
    expect(stepDuration(30, -1)).toBeNull();
    expect(stepDuration(60, 1)).toBe(90);
    expect(stepDuration(1440, 1)).toBe(1440);
    expect(endOf({ startsAt: 1000, durationMin: 60 })).toBe(1000 + H);
    expect(endOf({ startsAt: 1000, durationMin: null })).toBeNull();
  });
});

describe("format", () => {
  it("formats times and days", () => {
    expect(formatTime(new Date(2026, 5, 10, 0, 5).getTime())).toBe("12:05 AM");
    expect(formatTime(new Date(2026, 5, 10, 12, 0).getTime())).toBe("12:00 PM");
    expect(formatTime(new Date(2026, 5, 10, 19, 30).getTime())).toBe("7:30 PM");
    expect(formatDay(NOW, NOW)).toBe("Today");
    expect(formatDay(NOW + 24 * H, NOW)).toBe("Tomorrow");
    expect(formatDay(new Date(2026, 5, 14, 12).getTime(), NOW)).toBe("Sun, Jun 14");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(30)).toBe("30 min");
  });

  it("formats the span with the end day when it differs", () => {
    const start = new Date(2026, 5, 10, 19, 30).getTime();
    expect(formatWhen(start, null, NOW)).toBe("Today  ·  7:30 PM");
    expect(formatWhen(start, new Date(2026, 5, 10, 22, 0).getTime(), NOW)).toBe("Today  ·  7:30 PM to 10:00 PM");
    expect(formatWhen(start, new Date(2026, 5, 11, 1, 0).getTime(), NOW)).toBe("Today  ·  7:30 PM to Tomorrow 1:00 AM");
  });
});
