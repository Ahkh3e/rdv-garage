export type SheetStop = "large" | "half" | "small";

// The share of the screen the map takes at each stop, largest map first.
export const SHEET_STOPS: Record<SheetStop, number> = { large: 0.75, half: 0.5, small: 0.25 };
export const SHEET_ORDER: SheetStop[] = ["large", "half", "small"];

const FLING_MS = 200;

// Where a drag released at mapHeight lands. velocity is the finger's speed in px/ms, positive downward, and carries the
// release forward a little so a flick reaches the next stop.
export function snapStop(mapHeight: number, screenHeight: number, velocity = 0): SheetStop {
  if (screenHeight <= 0) return "half";
  const projected = (mapHeight + velocity * FLING_MS) / screenHeight;
  let best: SheetStop = "half";
  for (const stop of SHEET_ORDER) if (Math.abs(SHEET_STOPS[stop] - projected) < Math.abs(SHEET_STOPS[best] - projected)) best = stop;
  return best;
}

// Tapping the handle walks the stops and turns around at each end: halfway, small, halfway, large, halfway, and so on.
// The first tap from halfway opens the member list.
export function tapStop(current: SheetStop, direction: 1 | -1): { stop: SheetStop; direction: 1 | -1 } {
  const index = SHEET_ORDER.indexOf(current);
  let turned = direction;
  if (index + direction < 0 || index + direction >= SHEET_ORDER.length) turned = direction === 1 ? -1 : 1;
  return { stop: SHEET_ORDER[index + turned]!, direction: turned };
}

// At least the halfway stop: used when something needs the map back, such as jumping to a member.
export const atLeastHalf = (stop: SheetStop): SheetStop => (stop === "small" ? "half" : stop);

// Pulling the list down at its top lets the map out one stop.
export const biggerMap = (stop: SheetStop): SheetStop => (stop === "small" ? "half" : "large");

// Room for a column of buttons between the live pill and the Go live button at this map height.
export function zoomControlsFit(mapHeight: number, topReserved: number, bottomReserved: number, buttons: number, size = 44, gap = 12): boolean {
  return mapHeight - topReserved - bottomReserved >= buttons * size + (buttons - 1) * gap;
}
