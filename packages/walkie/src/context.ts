import { useShell, type Shell } from "@rdv/core";
import type { WalkieController } from "./controller";

export interface WalkieKit {
  controller: WalkieController;
  disclaimerSeen: { get(): Promise<boolean>; set(): Promise<void> };
  openSettings(): void;
}

const kits = new WeakMap<object, WalkieKit>();

export const setKit = (shell: Shell, kit: WalkieKit) => void kits.set(shell, kit);

export function useKit(): WalkieKit {
  const kit = kits.get(useShell());
  if (!kit) throw new Error("walkie module is not registered");
  return kit;
}
