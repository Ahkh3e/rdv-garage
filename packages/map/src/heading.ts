// Small left and right wobbles in heading (a wandering GPS, a lane change) should not swing the camera or turn the car.
// A heading holds its angle until it has changed by more than the threshold, then moves to the new one.
export const TURN_THRESHOLD_DEG = 30;

export function angleDiff(a: number, b: number): number {
  return Math.abs((((b - a) % 360) + 540) % 360 - 180);
}

export function holdHeading(held: number | undefined, next: number, threshold = TURN_THRESHOLD_DEG): number {
  if (held === undefined) return next;
  return angleDiff(held, next) > threshold ? next : held;
}
