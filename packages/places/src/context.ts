import { useShell, type Shell } from "@rdv/core";
import type { PlacesController } from "./controller";

const controllers = new WeakMap<object, PlacesController>();

export const setController = (shell: Shell, controller: PlacesController) => void controllers.set(shell, controller);

export function useController(): PlacesController {
  const controller = controllers.get(useShell());
  if (!controller) throw new Error("places module is not registered");
  return controller;
}
