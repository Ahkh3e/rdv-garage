import type { DirectionsTarget } from "@rdv/core";

export type MapsApp = "waze" | "apple" | "google";
export type OS = "ios" | "android";

export const DEFAULT_APP: MapsApp = "waze";
export const APP_NAMES: Record<MapsApp, string> = { waze: "Waze", apple: "Apple Maps", google: "Google Maps" };

export const appsFor = (os: OS): MapsApp[] => (os === "ios" ? ["waze", "apple", "google"] : ["waze", "google"]);

const coord = (n: number) => String(Number(n.toFixed(6)));

export function directionsUrl(app: MapsApp, { lat, lng, label }: DirectionsTarget): string {
  const ll = `${coord(lat)},${coord(lng)}`;
  if (app === "apple") return `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(label)}`;
  if (app === "google") return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
  return `https://waze.com/ul?ll=${ll}&navigate=yes`;
}

export const webFallbackUrl = (target: DirectionsTarget) => directionsUrl("waze", target);

// Schemes declared in the app config (iPhone query schemes, Android manifest queries). Apple Maps is always present on iPhone.
export const PROBE_SCHEMES: Record<OS, Partial<Record<MapsApp, string>>> = {
  ios: { waze: "waze://", google: "comgooglemaps://" },
  android: { waze: "waze://", google: "google.navigation:q=0,0" },
};

export type Plan =
  | { kind: "open"; app: MapsApp }
  | { kind: "choose"; missing: MapsApp; options: MapsApp[] }
  | { kind: "web" };

export function planHandoff(os: OS, preferred: MapsApp | null, installed: MapsApp[]): Plan {
  const allowed = appsFor(os);
  const want = preferred && allowed.includes(preferred) ? preferred : DEFAULT_APP;
  if (installed.includes(want)) return { kind: "open", app: want };
  const options = allowed.filter((app) => app !== want && installed.includes(app));
  return options.length > 0 ? { kind: "choose", missing: want, options } : { kind: "web" };
}

export const isMapsApp = (value: unknown): value is MapsApp => value === "waze" || value === "apple" || value === "google";
