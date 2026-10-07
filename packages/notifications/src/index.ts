import { AppState } from "react-native";
import type { Module, Shell } from "@rdv/core";
import { newlyLive } from "./friends";
import { createNotifier, type Notifier } from "./notifier";

export { newlyLive, REUSE_AFTER_MS } from "./friends";
export { LIVE_NOTIFICATION_ID } from "./notifier";

// Local notifications while the app is running: one that stays up while you are live, and one when a crew member goes
// live while you are away from the app. Remote push (the app closed) needs a server and Apple and Google keys and is
// specified in docs/features/notifications.md in the spec repo.
export function startNotifications(shell: Shell, notifier: Notifier, appState: () => string = () => AppState.currentState): () => void {
  const seen = new Map<string, number>();
  const notified = new Map<string, number>();
  const offs: (() => void)[] = [];

  // Nothing is live when the app starts, so clear anything a killed session left behind.
  void notifier.hideLive();

  offs.push(
    shell.events.on("session.started", async () => {
      // Asking for notification permission here is for the friend notifications; the live indicator does not depend on it.
      void notifier.ensurePermission().catch(() => false);
      await notifier.showLive().catch(() => undefined);
    }),
    shell.events.on("session.ended", () => void notifier.hideLive()),
    shell.events.on("account.deleted", () => void notifier.hideLive()),
    shell.events.on("account.suspended", () => void notifier.hideLive()),
  );

  const onPositions = () => {
    const session = shell.session.get();
    const selfId = session.status === "signedIn" ? session.userId : null;
    const positions = Object.values(shell.locationStream.store.get());
    const selected = new Set(shell.crewContext.store.get().selected);
    const members = positions.filter((p) => p.crewIds.some((id) => selected.has(id)));
    const fresh = newlyLive(members, seen, notified, Date.now(), selfId);
    // On screen the map already shows them, so a banner is only for someone who is away from the app.
    if (fresh.length === 0 || appState() === "active") return;
    const crews = shell.crewContext.store.get().crews;
    for (const member of fresh) {
      const shared = crews.filter((c) => member.crewIds.includes(c.id) && selected.has(c.id) && c.members.some((m) => m.userId === member.userId));
      const handle = shared[0]?.members.find((m) => m.userId === member.userId)?.handle;
      if (!handle) continue;
      // Name the crew only when it is unambiguous: someone can share more than one crew with you.
      const crewName = shared.length === 1 ? shared[0]!.name : null;
      notified.set(member.userId, Date.now());
      void notifier
        .ensurePermission()
        .then(async (ok) => {
          if (ok) await notifier.showFriend(member.userId, handle, crewName);
        })
        .catch(() => undefined);
    }
  };
  offs.push(shell.locationStream.store.subscribe(onPositions));

  return () => offs.forEach((off) => off());
}

export const notifications: Module = {
  id: "notifications",
  register(shell) {
    shell.addFlag("notifications", true);
    if (!shell.isEnabled("notifications")) return;
    startNotifications(shell, createNotifier());
  },
};
