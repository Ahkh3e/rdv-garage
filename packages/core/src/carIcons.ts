// Eight minimal racecar silhouettes, seen from above with the nose pointing up, drawn on a 40 by 40 grid.
// Generic shapes only: no brand marks or real model names. Each has a body (with holes for windows, drawn evenodd)
// and wheels as [x, y, width, height].
export const CAR_ICON_KEYS = ["gt", "formula", "proto", "rally", "muscle", "hyper", "drift", "kart"] as const;
export type CarIconKey = (typeof CAR_ICON_KEYS)[number];
export const DEFAULT_CAR_ICON: CarIconKey = "gt";

export interface CarShape {
  name: string;
  body: string;
  wheels: [number, number, number, number][];
}

export const CAR_ICONS: Record<CarIconKey, CarShape> = {
  gt: {
    name: "GT",
    body: "M20 3C26 3 28.5 9 29 15L30 24C30.5 29 30 34 28 36.5C26 38 14 38 12 36.5C10 34 9.5 29 10 24L11 15C11.5 9 14 3 20 3ZM14.5 15L25.5 15L26.5 24L13.5 24Z",
    wheels: [[7, 9, 3.4, 7], [29.6, 9, 3.4, 7], [7, 26, 3.4, 8], [29.6, 26, 3.4, 8]],
  },
  formula: {
    name: "Formula",
    body: "M18.5 4L21.5 4L22.5 14L25 18L25 30L22.5 33L17.5 33L15 30L15 18L17.5 14ZM18.5 18L21.5 18L21.5 23L18.5 23ZM10 5L30 5L30 7.5L10 7.5ZM11 35L29 35L29 38L11 38Z",
    wheels: [[7.5, 9, 4.2, 8], [28.3, 9, 4.2, 8], [7, 24, 4.8, 9], [28.2, 24, 4.8, 9]],
  },
  proto: {
    name: "Prototype",
    body: "M20 2C25 2 27 8 27.5 14L28 30C28 35 24 38 20 38C16 38 12 35 12 30L12.5 14C13 8 15 2 20 2ZM16 14C16 11 24 11 24 14L25 22C25 25 15 25 15 22Z",
    wheels: [[8.6, 9, 3.4, 7], [28, 9, 3.4, 7], [8.6, 25, 3.4, 8], [28, 25, 3.4, 8]],
  },
  rally: {
    name: "Rally",
    body: "M12 4L28 4Q30 4 30 6L30 34Q30 37 28 37L12 37Q10 37 10 34L10 6Q10 4 12 4ZM13 11L27 11L26 17L14 17ZM14 27L26 27L27 31L13 31ZM17 19L23 19L23 25L17 25Z",
    wheels: [[6.6, 8, 3.2, 7], [30.2, 8, 3.2, 7], [6.6, 26, 3.2, 7], [30.2, 26, 3.2, 7]],
  },
  muscle: {
    name: "Muscle",
    body: "M11 3L29 3Q31 3 31 5L31 35Q31 37.5 29 37.5L11 37.5Q9 37.5 9 35L9 5Q9 3 11 3ZM13 14L27 14L26 19.5L14 19.5ZM14 26L26 26L27 30L13 30ZM19 5L21 5L21 12L19 12Z",
    wheels: [[5.6, 6, 3.2, 7.5], [31.2, 6, 3.2, 7.5], [5.6, 26, 3.2, 7.5], [31.2, 26, 3.2, 7.5]],
  },
  hyper: {
    name: "Hypercar",
    body: "M20 2C23 2 26 6 28 13L31 24C32 29 31 34 28 37L12 37C9 34 8 29 9 24L12 13C14 6 17 2 20 2ZM16 14L24 14L26 22L14 22ZM8 36L32 36L32 38.5L8 38.5Z",
    wheels: [[6.2, 8, 3.6, 8], [30.2, 8, 3.6, 8], [5.8, 26, 4, 9], [30.2, 26, 4, 9]],
  },
  drift: {
    name: "Drift",
    body: "M14 4L26 4Q29 4 29.5 8L30 15L30 30Q30 36 26 36.5L14 36.5Q10 36 10 30L10 15L10.5 8Q11 4 14 4ZM14 13L26 13L25.5 19L14.5 19ZM14.5 26L25.5 26L26 29.5L14 29.5ZM11 37.5L29 37.5L29 39.5L11 39.5Z",
    wheels: [[5.2, 7, 4, 8], [30.8, 7, 4, 8], [5, 25, 4.6, 9], [30.4, 25, 4.6, 9]],
  },
  kart: {
    name: "Kart",
    body: "M15 5L25 5L26 10L28 14L28 28L26 32L14 32L12 28L12 14L14 10ZM17 18L23 18L23 26L17 26ZM16 12L24 12L24 13.5L16 13.5ZM12 3L28 3L28 4.8L12 4.8ZM12 34L28 34L28 35.8L12 35.8Z",
    wheels: [[7.6, 7, 4, 8], [28.4, 7, 4, 8], [7.2, 24, 4.6, 9], [28.2, 24, 4.6, 9]],
  },
};

export function carIconKey(value: unknown): CarIconKey {
  return typeof value === "string" && (CAR_ICON_KEYS as readonly string[]).includes(value) ? (value as CarIconKey) : DEFAULT_CAR_ICON;
}
