// Design tokens from docs/design.md in the spec repo.
export const colors = {
  background: "#080A0F",
  s1: "#0E1118",
  surface: "#12161E",
  raised: "#181D27",
  hairline: "rgba(150,170,210,0.10)",
  border: "rgba(150,170,210,0.18)",
  focus: "rgba(76,141,255,0.70)",
  text: "#F2F5FA",
  muted: "#A3ABBA",
  subtle: "#6B7385",
  disabled: "#444B5A",
  accent: "#2F6FF2",
  accentBright: "#5EA0FF",
  accentPressed: "#2559C4",
  accentSoft: "rgba(76,141,255,0.16)",
  onAccent: "#FFFFFF",
  danger: "#FF453A",
  scrim: "rgba(0,0,0,0.62)",
  press: "rgba(150,170,210,0.06)",
  fill: "rgba(150,170,210,0.08)",
} as const;

// Floating layers (map controls, the tab bar, sheets) are glass. Rows and cards inside them stay flat.
export const glass = {
  sheet: { intensity: 60, overlay: "rgba(8,10,15,0.58)" },
  control: { intensity: 40, overlay: "rgba(14,17,24,0.55)" },
  bar: { intensity: 80, overlay: "rgba(8,10,15,0.74)" },
  solid: "rgba(18,22,30,0.96)",
} as const;

// Six fixed, desaturated tints for crew markers, paired with distinct shapes. Used only for crew markers and labels.
export const crewTints = ["#7FA6C9", "#9FBF8A", "#C9A97F", "#B393C9", "#C98F8F", "#7FC9BF"] as const;
export const crewShapes = ["circle", "square", "diamond", "hexagon", "triangle", "pill"] as const;

export function crewStyle(index: number): { tint: string; shape: (typeof crewShapes)[number] } {
  const i = ((index % crewTints.length) + crewTints.length) % crewTints.length;
  return { tint: crewTints[i]!, shape: crewShapes[i]! };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
// One radius family. Sheets use lg; everything else md or sm.
export const radii = { sm: 10, md: 14, xl: 22, lg: 28, pill: 999 } as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  display: "InterTight_600SemiBold",
  displayBold: "InterTight_700Bold",
  mono: "JetBrainsMono_500Medium",
} as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 15, lineHeight: 22 },
  default: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 22, lineHeight: 28 },
  large: { fontSize: 32, lineHeight: 36 },
  hero: { fontSize: 40, lineHeight: 42 },
} as const;

export const motion = { press: 100, fast: 160, normal: 240, screen: 320 } as const;
