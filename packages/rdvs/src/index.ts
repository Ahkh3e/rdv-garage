import type { Module } from "@rdv/core";
import { RDV_CREATE_ROUTE } from "@rdv/core/places";
import { createRdvsController, DETAIL_ROUTE, EDIT_ROUTE, PLANS_ROUTE, STATS_ROUTE } from "./controller";
import { setController } from "./context";
import { readPosition, reminders } from "./native";
import { PlansButton } from "./PlansButton";
import { CrewRdvs } from "./CrewRdvs";
import { PlansScreen } from "./PlansScreen";
import { RdvDetail } from "./RdvDetail";
import { RdvForm } from "./RdvForm";
import { StatsScreen } from "./StatsScreen";

export const rdvs: Module = {
  id: "rdvs",
  register(shell) {
    shell.addFlag("rdvs", true);
    if (!shell.isEnabled("rdvs")) return;
    const controller = createRdvsController(shell, { reminders, readPosition });
    setController(shell, controller);
    shell.pins.register({ id: "rdvs", pins: controller.pins });
    shell.addRoute({ name: RDV_CREATE_ROUTE, component: RdvForm, title: "New RDV" });
    shell.addRoute({ name: EDIT_ROUTE, component: RdvForm, title: "Edit RDV" });
    shell.addRoute({ name: DETAIL_ROUTE, component: RdvDetail, title: "RDV" });
    shell.addRoute({ name: PLANS_ROUTE, component: PlansScreen, title: "Plans" });
    shell.addRoute({ name: STATS_ROUTE, component: StatsScreen, title: "Stats" });
    shell.addMenuItem({ id: "stats", title: "Stats", icon: "stats-chart-outline", route: STATS_ROUTE, order: 15 });
    shell.addSlot("map.overlay", PlansButton, 20);
    shell.addSlot("crew.detail", CrewRdvs, 10);

    let stop: (() => void) | null = null;
    shell.session.subscribe(() => {
      const signedIn = shell.session.get().status === "signedIn";
      if (signedIn && !stop) stop = controller.start();
      else if (!signedIn && stop) {
        stop();
        stop = null;
      }
    });
  },
};
