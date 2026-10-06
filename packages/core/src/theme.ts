// Design tokens from docs/design.md in the spec repo.
export const colors = {
  background: "#0A0A0B",
  s1: "#101013",
  surface: "#16161A",
  raised: "#1D1D22",
  hairline: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.12)",
  focus: "rgba(255,79,31,0.60)",
  text: "#F4F4F5",
  muted: "#A1A1AA",
  subtle: "#6E6E78",
  disabled: "#45454D",
  accent: "#FF4F1F",
  accentPressed: "#E8431A",
  accentSoft: "rgba(255,79,31,0.14)",
  onAccent: "#0A0A0B",
  danger: "#FF453A",
  scrim: "rgba(0,0,0,0.60)",
  press: "rgba(255,255,255,0.04)",
  fill: "rgba(255,255,255,0.06)",
} as const;

// Floating layers (map controls, the tab bar, sheets) are glass. Rows and cards inside them stay flat.
export const glass = {
  sheet: { intensity: 60, overlay: "rgba(10,10,11,0.55)" },
  control: { intensity: 40, overlay: "rgba(16,16,19,0.50)" },
  bar: { intensity: 80, overlay: "rgba(10,10,11,0.72)" },
  solid: "rgba(22,22,26,0.96)",
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
export const radii = { sm: 10, md: 14, lg: 28, pill: 999 } as const;

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
