import type { Module } from "@rdv/core";
import { MapsAppScreen } from "./MapsAppScreen";
import { handoff, prefs } from "./native";

export { APP_NAMES, directionsUrl, planHandoff, webFallbackUrl, type MapsApp } from "./apps";

export const mapsHandoff: Module = {
  id: "maps-handoff",
  register(shell) {
    shell.addFlag("maps-handoff", true);
    if (!shell.isEnabled("maps-handoff")) return;
    void prefs.load();
    shell.setHandoff(handoff);
    shell.addRoute({ name: "MapsApp", component: MapsAppScreen, title: "Maps app" });
    shell.addMenuItem({ id: "maps-app", title: "Maps app", icon: "navigate-outline", route: "MapsApp", order: 20 });
  },
};
