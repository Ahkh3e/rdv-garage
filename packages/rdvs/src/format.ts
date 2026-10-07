const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function formatDay(ms: number, now: number): string {
  if (sameDay(ms, now)) return "Today";
  if (sameDay(ms, now + 86400000)) return "Tomorrow";
  const d = new Date(ms);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// "Tomorrow  ·  7:30 PM to 10:30 PM", with the end day added when it falls on another day.
export function formatWhen(startsAt: number, endsAt: number | null, now: number): string {
  const start = `${formatDay(startsAt, now)}  ·  ${formatTime(startsAt)}`;
  if (endsAt === null) return start;
  return sameDay(startsAt, endsAt) ? `${start} to ${formatTime(endsAt)}` : `${start} to ${formatDay(endsAt, now)} ${formatTime(endsAt)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}
