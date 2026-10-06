import { Platform } from "react-native";
import { torontoWeekStart, type CrewId, type Shell } from "@rdv/core";
import { LiveEngine, TICK_MS, type Fix } from "./engine";
import type { ChannelHub } from "./hub";
import { ensureLocationPermission, type PermissionResult } from "./permissions";
import { setFixSink, startUpdates, stopUpdates } from "./task";

export interface LiveController {
  goLive(crewIds: CrewId[]): Promise<PermissionResult>;
  stop(): Promise<void>;
  liveCrews(): CrewId[];
}

export function createController(shell: Shell, hub: ChannelHub): LiveController {
  let engine: LiveEngine | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let releases: (() => void)[] = [];

  const build = (userId: string): LiveEngine =>
    new LiveEngine({
      userId,
      now: () => Date.now(),
      weekOf: (ts) => torontoWeekStart(ts),
      startSession: (crewIds) => shell.backend.rpc<string>("live", "start_session", { p_crew_ids: crewIds, p_platform: Platform.OS }),
      checkpoint: async (sessionId, speed, dist) => {
        const week = await shell.backend.rpc<string>("live", "checkpoint_session", { p_session: sessionId, p_max_speed_kmh: speed, p_distance_m: dist });
        return week;
      },
      endSession: async (sessionId) => void (await shell.backend.rpc("live", "end_session", { p_session: sessionId })),
      broadcast: (crewId, event, payload) => hub.send(crewId, event, payload),
      publishSelf: (position) => {
        if (position) shell.locationStream.publish({ userId, crewIds: position.crewIds, lat: position.lat, lng: position.lng, heading: position.heading, ts: position.ts });
        else shell.locationStream.remove(userId);
      },
      onError: (error) => console.warn("live session error", error),
    });

  async function stop() {
    const current = engine;
    if (!current) return;
    engine = null;
    setFixSink(null);
    if (timer) clearInterval(timer);
    timer = null;
    const sessionId = current.sessionId;
    for (const crewId of current.crewIds) hub.untrack(crewId);
    await stopUpdates().catch(() => undefined);
    await current.stop();
    releases.forEach((release) => release());
    releases = [];
    shell.live.set({ live: false, sessionId: null, crewIds: [] });
    if (sessionId) shell.events.emit({ type: "session.ended", sessionId });
  }

  async function goLive(crewIds: CrewId[]): Promise<PermissionResult> {
    const session = shell.session.get();
    if (session.status !== "signedIn" || engine) return "denied";
    const permission = await ensureLocationPermission();
    if (permission !== "ok") return permission;

    const next = build(session.userId);
    engine = next;
    // Join the crew channels first so the first positions are not dropped.
    releases = crewIds.map((crewId) => hub.acquire(crewId));
    try {
      const sessionId = await next.start(crewIds);
      const names = shell.crewContext.store.get().crews.filter((c) => crewIds.includes(c.id)).map((c) => c.name);
      setFixSink((fix: Fix) => next.onFix(fix));
      await startUpdates(names);
      timer = setInterval(() => void next.maybeTick(Date.now()), TICK_MS);
      for (const crewId of crewIds) hub.track(crewId, { user_id: session.userId, handle: session.profile.handle });
      shell.live.set({ live: true, sessionId, crewIds });
      shell.events.emit({ type: "session.started", sessionId, crewIds });
      return "ok";
    } catch (error) {
      engine = null;
      releases.forEach((release) => release());
      releases = [];
      setFixSink(null);
      await stopUpdates().catch(() => undefined);
      throw error;
    }
  }

  const stopOnGone = () => void stop();
  shell.events.on("account.suspended", stopOnGone);
  shell.events.on("account.deleted", stopOnGone);
  shell.session.subscribe(() => {
    if (shell.session.get().status !== "signedIn") void stop();
  });
  // Leaving or being removed from a crew you are live to drops it from the session on the server; stop sharing locally too.
  shell.crewContext.store.subscribe(() => {
    if (!engine) return;
    const ids = new Set(shell.crewContext.store.get().crews.map((c) => c.id));
    if (shell.crewContext.store.get().loaded && engine.crewIds.every((id) => !ids.has(id))) void stop();
  });

  return { goLive, stop, liveCrews: () => engine?.crewIds ?? [] };
}
