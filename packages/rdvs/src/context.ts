import { useShell, type Shell } from "@rdv/core";
import type { RdvsController } from "./controller";

const controllers = new WeakMap<object, RdvsController>();

export const setController = (shell: Shell, controller: RdvsController) => void controllers.set(shell, controller);

export function useController(): RdvsController {
  const controller = controllers.get(useShell());
  if (!controller) throw new Error("rdvs module is not registered");
  return controller;
}
