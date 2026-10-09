export const CAR_COLOR_KEYS = ["blue", "cyan", "green", "lime", "yellow", "orange", "red", "pink", "purple", "white"] as const;
export type CarColorKey = (typeof CAR_COLOR_KEYS)[number];

export const CAR_COLORS: Record<CarColorKey, { name: string; hex: string }> = {
  blue: { name: "Blue", hex: "#3D7BFF" },
  cyan: { name: "Cyan", hex: "#1FE0FF" },
  green: { name: "Green", hex: "#2BFF88" },
  lime: { name: "Lime", hex: "#B4FF2B" },
  yellow: { name: "Yellow", hex: "#FFE62B" },
  orange: { name: "Orange", hex: "#FF8A1F" },
  red: { name: "Red", hex: "#FF3B4E" },
  pink: { name: "Pink", hex: "#FF4FD8" },
  purple: { name: "Purple", hex: "#A55CFF" },
  white: { name: "White", hex: "#F2F5FA" },
};

export function carColorKey(value: unknown): CarColorKey | null {
  return typeof value === "string" && (CAR_COLOR_KEYS as readonly string[]).includes(value) ? (value as CarColorKey) : null;
}

export function carColorHex(value: unknown): string | null {
  const key = carColorKey(value);
  return key ? CAR_COLORS[key].hex : null;
}
