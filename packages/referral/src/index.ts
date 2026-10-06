import type { Module } from "@rdv/core";
import { Invites } from "./Invites";

export const referral: Module = {
  id: "referral",
  register(shell) {
    shell.addFlag("referral", true);
    shell.addRoute({ name: "Invites", component: Invites, title: "Share invite" });
    shell.addMenuItem({ id: "invites", title: "Share invite", icon: "paper-plane-outline", route: "Invites", order: 10 });
  },
};
