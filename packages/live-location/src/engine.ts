import { haversineMeters, msToKmh } from "@rdv/core/geo";

export interface Fix {
  lat: number;
  lng: number;
  speedMs: number | null;
  heading: number | null;
  accuracy: number | null;
  ts: number;
}

export interface EngineDeps {
  userId: string;
  now(): number;
  weekOf(ts: number): string;
  startSession(crewIds: string[]): Promise<string>;
  checkpoint(sessionId: string, maxSpeedKmh: number | null, distanceM: number | null): Promise<string>;
  endSession(sessionId: string): Promise<void>;
  broadcast(crewId: string, event: "pos" | "stop", payload: Record<string, unknown>): void;
  publishSelf(position: { lat: number; lng: number; heading: number | null; ts: number; crewIds: string[] } | null): void;
  onError?(error: unknown): void;
}

export const MOVING_BROADCAST_MS = 3000;
export const STATIONARY_BROADCAST_MS = 15000;
export const TICK_MS = 30000;
const MOVING_SPEED_MS = 1;
const MAX_JUMP_M = 1500;

// Drives a live session: cadence of position broadcasts, per-week speed and distance segments,
// and the checkpoint/heartbeat calls that keep the session alive on the server.
export class LiveEngine {
  sessionId: string | null = null;
  crewIds: string[] = [];
  private week = "";
  private maxKmh = 0;
  private distanceM = 0;
  private lastFix: Fix | null = null;
  private lastBroadcast = 0;
  private lastTick = 0;
  private tickCount = 0;
  private moving = false;
  private restarting = false;

  constructor(private readonly deps: EngineDeps) {}

  get isLive(): boolean {
    return this.sessionId !== null;
  }

  get segment() {
    return { week: this.week, maxKmh: this.maxKmh, distanceM: this.distanceM };
  }

  get isMoving(): boolean {
    return this.moving;
  }

  async start(crewIds: string[]): Promise<string> {
    this.sessionId = await this.deps.startSession(crewIds);
    this.crewIds = crewIds;
    const now = this.deps.now();
    this.week = this.deps.weekOf(now);
    this.maxKmh = 0;
    this.distanceM = 0;
    this.lastFix = null;
    this.lastBroadcast = 0;
    this.lastTick = now;
    this.tickCount = 0;
    this.moving = false;
    return this.sessionId;
  }

  onFix(fix: Fix): void {
    if (!this.sessionId) return;
    const week = this.deps.weekOf(fix.ts);
    if (week !== this.week) {
      // New week: the segment starts from zero and never carries last week's max forward.
      this.week = week;
      this.maxKmh = 0;
      this.distanceM = 0;
    }
    if (this.lastFix) {
      const d = haversineMeters(this.lastFix, fix);
      if (d < MAX_JUMP_M) this.distanceM += d;
    }
    if (fix.speedMs !== null && fix.speedMs >= 0) {
      this.maxKmh = Math.max(this.maxKmh, msToKmh(fix.speedMs));
      this.moving = fix.speedMs > MOVING_SPEED_MS;
    } else if (this.lastFix) {
      this.moving = haversineMeters(this.lastFix, fix) / Math.max(1, (fix.ts - this.lastFix.ts) / 1000) > MOVING_SPEED_MS;
    }
    this.lastFix = fix;

    this.deps.publishSelf({ lat: fix.lat, lng: fix.lng, heading: fix.heading, ts: fix.ts, crewIds: this.crewIds });

    const interval = this.moving ? MOVING_BROADCAST_MS : STATIONARY_BROADCAST_MS;
    if (fix.ts - this.lastBroadcast >= interval) {
      this.lastBroadcast = fix.ts;
      for (const crewId of this.crewIds) {
        // Speed is never broadcast: it is shown after the session, not live (decision 0007).
        this.deps.broadcast(crewId, "pos", { user_id: this.deps.userId, lat: fix.lat, lng: fix.lng, heading: fix.heading, ts: fix.ts });
      }
    }
    void this.maybeTick(this.deps.now());
  }

  // A parked car stops producing location fixes, so nothing would be broadcast. Called on a short timer: when the
  // member is not moving and the stationary interval has passed, send the last known position again with a fresh timestamp.
  rebroadcast(now: number): void {
    if (!this.sessionId || !this.lastFix || this.moving) return;
    if (now - this.lastBroadcast < STATIONARY_BROADCAST_MS) return;
    this.lastBroadcast = now;
    const f = this.lastFix;
    for (const crewId of this.crewIds) {
      this.deps.broadcast(crewId, "pos", { user_id: this.deps.userId, lat: f.lat, lng: f.lng, heading: f.heading, ts: now });
    }
    this.deps.publishSelf({ lat: f.lat, lng: f.lng, heading: f.heading, ts: now, crewIds: this.crewIds });
  }

  // Stop sharing with crews the person is no longer in. Returns the crews that remain.
  dropCrews(ids: string[]): string[] {
    for (const crewId of this.crewIds) {
      if (ids.includes(crewId)) this.deps.broadcast(crewId, "stop", { user_id: this.deps.userId, ts: this.deps.now() });
    }
    this.crewIds = this.crewIds.filter((id) => !ids.includes(id));
    return this.crewIds;
  }

  // Called by a timer as well as from fixes, so a throttled timer in the background cannot stall the session.
  async maybeTick(now: number): Promise<void> {
    if (!this.sessionId || now - this.lastTick < TICK_MS) return;
    this.lastTick = now;
    this.tickCount += 1;
    // Moving: a checkpoint about once a minute. Stationary: a heartbeat every tick.
    if (this.moving) {
      if (this.tickCount % 2 === 0) await this.sendCheckpoint(true);
    } else {
      await this.sendCheckpoint(false);
    }
  }

  private async sendCheckpoint(withValues: boolean): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    try {
      const serverWeek = await this.deps.checkpoint(id, withValues ? this.maxKmh : null, withValues ? this.distanceM : null);
      if (withValues && serverWeek && serverWeek !== this.week) {
        // Clocks disagree about the week: follow the server and start that segment from zero.
        this.week = serverWeek;
        this.maxKmh = 0;
        this.distanceM = 0;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "session_not_found") await this.restart();
      else this.deps.onError?.(error);
    }
  }

  // The server ended the session (for example after a long signal loss). Start a new one for the same crews.
  private async restart(): Promise<void> {
    const before = this.sessionId;
    if (this.restarting || !before) return;
    this.restarting = true;
    try {
      const next = await this.deps.startSession(this.crewIds);
      if (this.sessionId !== before) {
        // Stopped (or replaced) while the request was in flight: close the new session instead of leaking it.
        await this.deps.endSession(next).catch(() => undefined);
        return;
      }
      this.sessionId = next;
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.restarting = false;
    }
  }

  async stop(): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    this.sessionId = null;
    for (const crewId of this.crewIds) this.deps.broadcast(crewId, "stop", { user_id: this.deps.userId, ts: this.deps.now() });
    this.deps.publishSelf(null);
    try {
      if (this.maxKmh > 0 || this.distanceM > 0) await this.deps.checkpoint(id, this.maxKmh, this.distanceM);
    } catch {
      // The session is ending anyway.
    }
    try {
      await this.deps.endSession(id);
    } catch (error) {
      this.deps.onError?.(error);
    }
  }
}
