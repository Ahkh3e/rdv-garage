import type { CrewId, Shell } from "@rdv/core";
import type { ChannelHub } from "./hub";

const DROP_AFTER_MS = 5 * 60 * 1000;

// Listens on the channels of the selected crews (and any crew we are live to) and feeds the shared location stream.
export function startReceiver(shell: Shell, hub: ChannelHub, extraCrews: () => CrewId[]): () => void {
  const subscriptions = new Map<CrewId, { release: () => void; unlisten: () => void }>();
  const memberCrews = new Map<string, Set<CrewId>>();
  const lastPosition = new Map<string, { lat: number; lng: number; heading: number | null; ts: number }>();

  const publish = (userId: string) => {
    const crews = memberCrews.get(userId);
    const pos = lastPosition.get(userId);
    if (!crews || crews.size === 0 || !pos) return shell.locationStream.remove(userId);
    shell.locationStream.publish({ userId, crewIds: [...crews], ...pos });
  };

  const handle = (crewId: CrewId) => (event: "pos" | "stop", payload: any) => {
    const userId: string | undefined = payload?.user_id;
    if (!userId || userId === shell.backend.userId()) return;
    if (event === "stop") {
      const crews = memberCrews.get(userId);
      crews?.delete(crewId);
      if (!crews || crews.size === 0) {
        memberCrews.delete(userId);
        lastPosition.delete(userId);
      }
      return publish(userId);
    }
    if (typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
    const crews = memberCrews.get(userId) ?? new Set<CrewId>();
    crews.add(crewId);
    memberCrews.set(userId, crews);
    lastPosition.set(userId, { lat: payload.lat, lng: payload.lng, heading: typeof payload.heading === "number" ? payload.heading : null, ts: typeof payload.ts === "number" ? payload.ts : Date.now() });
    publish(userId);
  };

  const sync = () => {
    const session = shell.session.get();
    const wanted = new Set<CrewId>(session.status === "signedIn" ? [...shell.crewContext.store.get().selected, ...extraCrews()] : []);
    for (const [crewId, sub] of subscriptions) {
      if (!wanted.has(crewId)) {
        sub.unlisten();
        sub.release();
        subscriptions.delete(crewId);
        for (const [userId, crews] of memberCrews) {
          crews.delete(crewId);
          if (crews.size === 0) {
            memberCrews.delete(userId);
            lastPosition.delete(userId);
          }
          publish(userId);
        }
      }
    }
    for (const crewId of wanted) {
      if (subscriptions.has(crewId)) continue;
      const release = hub.acquire(crewId);
      const unlisten = hub.listen(crewId, handle(crewId));
      subscriptions.set(crewId, { release, unlisten });
    }
    if (session.status !== "signedIn") shell.locationStream.clear();
  };

  const offCrews = shell.crewContext.store.subscribe(sync);
  const offSession = shell.session.subscribe(sync);
  const offLive = shell.live.subscribe(sync);
  sync();

  // Members who go quiet without saying goodbye are dropped after a while.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - DROP_AFTER_MS;
    for (const [userId, pos] of lastPosition) {
      if (pos.ts < cutoff) {
        lastPosition.delete(userId);
        memberCrews.delete(userId);
        shell.locationStream.remove(userId);
      }
    }
  }, 15000);

  return () => {
    clearInterval(sweep);
    offCrews();
    offSession();
    offLive();
    for (const sub of subscriptions.values()) {
      sub.unlisten();
      sub.release();
    }
    subscriptions.clear();
  };
}
