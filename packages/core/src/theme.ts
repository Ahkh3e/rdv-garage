// Design tokens from docs/design.md in the spec repo.
export const colors = {
  background: "#0A0A0B",
  surface: "#131316",
  raised: "#1C1C21",
  border: "#2A2A31",
  text: "#F4F4F5",
  muted: "#8C8C96",
  accent: "#FF4F1F",
  danger: "#FF453A",
} as const;

// Six fixed, desaturated tints for crew markers, paired with distinct shapes. Used only for crew markers and labels.
export const crewTints = ["#7FA6C9", "#9FBF8A", "#C9A97F", "#B393C9", "#C98F8F", "#7FC9BF"] as const;
export const crewShapes = ["circle", "square", "diamond", "hexagon", "triangle", "pill"] as const;

export function crewStyle(index: number): { tint: string; shape: (typeof crewShapes)[number] } {
  const i = ((index % crewTints.length) + crewTints.length) % crewTints.length;
  return { tint: crewTints[i]!, shape: crewShapes[i]! };
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const fonts = {
  regular: "Inter_400Regular",
  semibold: "Inter_600SemiBold",
  mono: "JetBrainsMono_500Medium",
} as const;

export const type = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  default: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 20, lineHeight: 26 },
  large: { fontSize: 28, lineHeight: 34 },
} as const;

export const motion = { fast: 150, normal: 250 } as const;

// Dark map style for Google Maps on Android. Apple Maps uses the system dark appearance.
export const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#101013" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8C8C96" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A0A0B" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2A2A31" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1C1C21" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#24242A" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2E2E36" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#07070A" }] },
];
