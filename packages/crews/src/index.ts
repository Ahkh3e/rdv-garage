import type { Module } from "@rdv/core";
import { loadCrews } from "./data";
import { CrewDetail } from "./screens/CrewDetail";
import { CrewsHome } from "./screens/CrewsHome";
import { CreateCrew } from "./screens/CreateCrew";
import { JoinCrew } from "./screens/JoinCrew";

export { loadCrews } from "./data";

export const crews: Module = {
  id: "crews",
  register(shell) {
    shell.addFlag("crews", true);
    shell.addTab({ id: "Crews", title: "Crews", icon: "people-outline", order: 20, component: CrewsHome });
    shell.addRoute({ name: "CrewDetail", component: CrewDetail, title: "Crew" });
    shell.addRoute({ name: "CreateCrew", component: CreateCrew, title: "New crew" });
    shell.addRoute({ name: "JoinCrew", component: JoinCrew, title: "Join crew" });

    // Load crews as soon as someone is signed in, and forget them on sign out.
    let loadedFor: string | null = null;
    shell.session.subscribe(() => {
      const state = shell.session.get();
      if (state.status === "signedIn" && loadedFor !== state.userId) {
        loadedFor = state.userId;
        loadCrews(shell).catch(() => undefined);
      } else if (state.status !== "signedIn") {
        loadedFor = null;
        shell.crewContext.setCrews([]);
      }
    });

    // Persist the selection that other modules change through the shared context.
    shell.events.on("crew.selected", ({ crewIds }) => {
      shell.backend.rpc("crews", "set_selected_crews", { p_crew_ids: crewIds }).catch(() => undefined);
    });
    shell.events.on("session.ended", () => void loadCrews(shell).catch(() => undefined));

    // A crew link: open the join screen with the code, or hold it until the person has an account.
    let heldCode: string | null = null;
    shell.addLinkHandler({
      kind: "crew",
      handle(link: { code: string }) {
        if (shell.session.get().status === "signedIn") shell.navigate("JoinCrew", { code: link.code });
        else heldCode = link.code;
      },
    });
    shell.session.subscribe(() => {
      if (heldCode && shell.session.get().status === "signedIn") {
        const code = heldCode;
        heldCode = null;
        shell.navigate("JoinCrew", { code });
      }
    });
  },
};
