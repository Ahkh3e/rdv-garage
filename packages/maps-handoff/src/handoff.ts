import type { DirectionsTarget, Handoff } from "@rdv/core";
import { PROBE_SCHEMES, appsFor, directionsUrl, planHandoff, webFallbackUrl, type MapsApp, type OS } from "./apps";

export interface HandoffDeps {
  os: OS;
  getPreferred(): MapsApp | null;
  setPreferred(app: MapsApp): void;
  canOpen(url: string): Promise<boolean>;
  open(url: string): Promise<void>;
  // Resolves to the app picked from the installed alternatives, or null if the person cancels.
  choose(chosen: { missing: MapsApp; options: MapsApp[] }): Promise<MapsApp | null>;
  // Asks whether to keep a choice made at the moment of handoff.
  confirmRemember(app: MapsApp): Promise<boolean>;
}

export async function detectInstalled(os: OS, canOpen: (url: string) => Promise<boolean>): Promise<MapsApp[]> {
  const probes = PROBE_SCHEMES[os];
  const found = await Promise.all(
    appsFor(os).map(async (app) => {
      if (os === "ios" && app === "apple") return true;
      const scheme = probes[app];
      return scheme ? canOpen(scheme).catch(() => false) : false;
    }),
  );
  return appsFor(os).filter((_, i) => found[i]);
}

export function createHandoff(deps: HandoffDeps): Handoff {
  return {
    async openDirections(target: DirectionsTarget) {
      const preferred = deps.getPreferred();
      const installed = await detectInstalled(deps.os, deps.canOpen);
      const plan = planHandoff(deps.os, preferred, installed);
      if (plan.kind === "open") return deps.open(directionsUrl(plan.app, target));
      if (plan.kind === "web") return deps.open(webFallbackUrl(target));
      const picked = await deps.choose({ missing: plan.missing, options: plan.options });
      if (!picked) return;
      await deps.open(directionsUrl(picked, target));
      if (await deps.confirmRemember(picked)) deps.setPreferred(picked);
    },
  };
}
