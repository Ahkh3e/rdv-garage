import type { Module } from "@rdv/core";
import { Board } from "./Board";

export const leaderboard: Module = {
  id: "leaderboard",
  register(shell) {
    shell.addFlag("leaderboard", true);
    if (!shell.isEnabled("leaderboard")) return;
    shell.addTab({ id: "Board", title: "Board", icon: "trophy-outline", order: 30, component: Board });
  },
};
