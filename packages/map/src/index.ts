import type { Module } from "@rdv/core";
import { MapScreen } from "./MapScreen";

export const map: Module = {
  id: "map",
  register(shell) {
    shell.addFlag("map", true);
    shell.addTab({ id: "Map", title: "Map", icon: "map-outline", order: 10, component: MapScreen });
  },
};
