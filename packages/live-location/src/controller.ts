import { Platform } from "react-native";
import { torontoWeekStart, type CrewId, type Shell } from "@rdv/core";
import { LiveEngine, TICK_MS, type Fix } from "./engine";
import type { ChannelHub } from "./hub";
import { ensureLocationPermission, type PermissionResult } from "./permissions";
import { setFixSink, startUpdates, stopUpdates } from "./task";

export interface LiveController {
  goLive(crewIds: CrewId[], options?: { shareSpeed?: boolean }): Promise<PermissionResult>;
  stop(): Promise<void>;
  liveCrews(): CrewId[];
}

// Everything that belongs to one live run, so stopping one run can never release another run's channels.
interface Run {
  engine: LiveEngine;
  releases: Map<CrewId, () => void>;
  timers: ReturnType<typeof setInterval>[];
}

const REBROADCAST_CHECK_MS = 5000;

export function createController(shell: Shell, hub: ChannelHub): LiveController {
  let run: Run | null = null;
  let starting = false;
  // Bumped by every stop, so a Go live that is still starting can tell it was cancelled (sign out, suspension, delete).
  let epoch = 0;

  const build = (userId: string): LiveEngine =>
    new LiveEngine({
      userId,
      now: () => Date.now(),
      weekOf: (ts) => torontoWeekStart(ts),
      startSession: (crewIds) => shell.backend.rpc<string>("live", "start_session", { p_crew_ids: crewIds, p_platform: Platform.OS }),
      checkpoint: async (sessionId, speed, dist, weekStart) =>
        shell.backend.rpc<string>("live", "checkpoint_session", {
          p_session: sessionId, p_max_speed_kmh: speed, p_distance_m: dist, ...(weekStart ? { p_week_start: weekStart } : {}),
        }),
      endSession: async (sessionId) => void (await shell.backend.rpc("live", "end_session", { p_session: sessionId })),
      broadcast: (crewId, event, payload) => hub.send(crewId, event, payload),
      publishSelf: (position) => {
        if (position) shell.locationStream.publish({ userId, crewIds: position.crewIds, lat: position.lat, lng: position.lng, heading: position.heading, ts: position.ts });
        else shell.locationStream.remove(userId);
      },
      onError: (error) => console.warn("live session error", error),
    });

  async function stop() {
    epoch += 1;
    const current = run;
    if (!current) return;
    run = null;
    setFixSink(null);
    current.timers.forEach((t) => clearInterval(t));
    const { engine } = current;
    const sessionId = engine.sessionId;
    for (const crewId of engine.crewIds) hub.untrack(crewId);
    await stopUpdates().catch(() => undefined);
    await engine.stop();
    current.releases.forEach((release) => release());
    current.releases.clear();
    // Only reset shared state if no newer run has started in the meantime.
    if (!run) shell.live.set({ live: false, sessionId: null, crewIds: [] });
    if (sessionId) shell.events.emit({ type: "session.ended", sessionId });
  }

  async function goLive(crewIds: CrewId[], options: { shareSpeed?: boolean } = {}): Promise<PermissionResult> {
    const session = shell.session.get();
    if (session.status !== "signedIn" || run || starting) return "denied";
    starting = true;
    const myEpoch = epoch;
    const cancelled = () => myEpoch !== epoch || shell.session.get().status !== "signedIn";
    try {
      const permission = await ensureLocationPermission();
      if (permission !== "ok") return permission;
      if (cancelled()) return "denied";

      const engine = build(session.userId);
      const releases = new Map<CrewId, () => void>(crewIds.map((id) => [id, hub.acquire(id)]));
      const current: Run = { engine, releases, timers: [] };
      try {
        const sessionId = await engine.start(crewIds, { shareSpeed: options.shareSpeed ?? false });
        if (cancelled()) throw new Error("cancelled");
        setFixSink((fix: Fix) => engine.onFix(fix));
        await startUpdates();
        if (cancelled()) throw new Error("cancelled");
        current.timers.push(setInterval(() => void engine.maybeTick(Date.now()), TICK_MS));
        current.timers.push(setInterval(() => engine.rebroadcast(Date.now()), REBROADCAST_CHECK_MS));
        for (const crewId of crewIds) hub.track(crewId, { user_id: session.userId, handle: session.profile.handle });
        run = current;
        shell.live.set({ live: true, sessionId, crewIds });
        shell.events.emit({ type: "session.started", sessionId, crewIds });
        return "ok";
      } catch (error) {
        // Do not leave a half-started session open on the server.
        setFixSink(null);
        current.timers.forEach((t) => clearInterval(t));
        await stopUpdates().catch(() => undefined);
        await engine.stop();
        releases.forEach((release) => release());
        if (cancelled() && error instanceof Error && error.message === "cancelled") return "denied";
        throw error;
      }
    } finally {
      starting = false;
    }
  }

  const stopOnGone = () => void stop();
  shell.events.on("account.suspended", stopOnGone);
  shell.events.on("account.deleted", stopOnGone);
  shell.session.subscribe(() => {
    if (shell.session.get().status !== "signedIn") void stop();
  });

  // Leaving or being removed from a crew you are live to must stop sharing with that crew straight away.
  shell.crewContext.store.subscribe(() => {
    const current = run;
    const crewState = shell.crewContext.store.get();
    if (!current || !crewState.loaded) return;
    const stillIn = new Set(crewState.crews.map((c) => c.id));
    const gone = current.engine.crewIds.filter((id) => !stillIn.has(id));
    if (gone.length === 0) return;
    // Say goodbye on those channels first, then let go of them; releasing first would drop the stop message.
    const left = current.engine.dropCrews(gone);
    for (const id of gone) {
      hub.untrack(id);
      current.releases.get(id)?.();
      current.releases.delete(id);
    }
    if (left.length === 0) void stop();
    else shell.live.set({ live: true, sessionId: current.engine.sessionId, crewIds: left });
  });

  return { goLive, stop, liveCrews: () => run?.engine.crewIds ?? [] };
}
