import { useShell, type Shell } from "@rdv/core";
import type { ChatController } from "./controller";

const controllers = new WeakMap<object, ChatController>();

export const setController = (shell: Shell, controller: ChatController) => void controllers.set(shell, controller);

export function useController(): ChatController {
  const controller = controllers.get(useShell());
  if (!controller) throw new Error("chat module is not registered");
  return controller;
}
