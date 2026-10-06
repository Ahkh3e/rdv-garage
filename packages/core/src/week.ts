// Toronto-time week math, matching private.week_start_of in the database.
const TZ = "America/Toronto";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Returns the Monday (YYYY-MM-DD) of the Toronto-time week containing the given instant.
export function torontoWeekStart(at: Date | number): string {
  const p: Record<string, string> = {};
  for (const part of parts.formatToParts(new Date(at))) p[part.type] = part.value;
  const daysBack = WEEKDAY_INDEX[p.weekday ?? "Mon"] ?? 0;
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - daysBack * 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

export function previousWeekStart(weekStart: string): string {
  return new Date(Date.parse(`${weekStart}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });

export function formatDaySet(isoDate: string): string {
  return dayFormat.format(new Date(`${isoDate}T12:00:00Z`));
}
