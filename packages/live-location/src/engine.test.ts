import { describe, expect, it } from "vitest";
import { LiveEngine, MOVING_BROADCAST_MS, STATIONARY_BROADCAST_MS, TICK_MS, type EngineDeps, type Fix } from "./engine";

function setup(overrides: Partial<EngineDeps> = {}) {
  const log: { broadcasts: { crew: string; event: string; payload: any }[]; checkpoints: any[]; started: string[][]; ended: string[]; self: any[] } = {
    broadcasts: [], checkpoints: [], started: [], ended: [], self: [],
  };
  let clock = Date.parse("2025-10-08T12:00:00Z");
  let sessions = 0;
  const deps: EngineDeps = {
    userId: "me",
    now: () => clock,
    weekOf: (ts) => (ts < Date.parse("2025-10-13T04:00:00Z") ? "2025-10-06" : "2025-10-13"),
    startSession: async (crewIds) => { log.started.push(crewIds); return `s${++sessions}`; },
    checkpoint: async (id, speed, dist) => { log.checkpoints.push({ id, speed, dist }); return "2025-10-06"; },
    endSession: async (id) => { log.ended.push(id); },
    broadcast: (crew, event, payload) => log.broadcasts.push({ crew, event, payload }),
    publishSelf: (p) => log.self.push(p),
    ...overrides,
  };
  const engine = new LiveEngine(deps);
  const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 43.65, lng: -79.38, speedMs: 20, heading: 90, accuracy: 5, ts: clock, ...over });
  return { engine, log, advance: (ms: number) => (clock += ms), now: () => clock, fix };
}

describe("LiveEngine", () => {
  it("starts a session for the chosen crews", async () => {
    const { engine, log } = setup();
    const id = await engine.start(["a", "b"]);
    expect(id).toBe("s1");
    expect(log.started).toEqual([["a", "b"]]);
    expect(engine.isLive).toBe(true);
  });

  it("broadcasts every 3 seconds while moving and never includes speed", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix());
    advance(1000); engine.onFix(fix({ ts: advance(0) }));
    advance(2100); engine.onFix(fix({ ts: advance(0) }));
    const pos = log.broadcasts.filter((b) => b.event === "pos");
    expect(pos.length).toBe(2);
    expect(Object.keys(pos[0]!.payload).sort()).toEqual(["heading", "lat", "lng", "ts", "user_id"]);
    expect(MOVING_BROADCAST_MS).toBe(3000);
  });

  it("broadcasts early when the direction changes, but not on a straight road", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    const north = (m: number) => 43.65 + m / 111320;
    engine.onFix(fix({ lat: north(0) }));
    advance(3000); engine.onFix(fix({ lat: north(45), ts: advance(0) }));
    advance(3000); engine.onFix(fix({ lat: north(90), ts: advance(0) }));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(3);
    advance(1100); engine.onFix(fix({ lat: north(105), ts: advance(0) }));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(3);
    advance(1100); engine.onFix(fix({ lat: north(105), lng: -79.38 + 25 / 80000, ts: advance(0) }));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(4);
  });

  it("broadcasts every 15 seconds while stationary", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    advance(5000); engine.onFix(fix({ speedMs: 0, ts: advance(0) }));
    advance(5000); engine.onFix(fix({ speedMs: 0, ts: advance(0) }));
    expect(log.broadcasts.length).toBe(1);
    advance(5100); engine.onFix(fix({ speedMs: 0, ts: advance(0) }));
    expect(log.broadcasts.length).toBe(2);
    expect(STATIONARY_BROADCAST_MS).toBe(15000);
  });

  it("tracks max speed in km/h and distance, and sends a checkpoint about once a minute while moving", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 25, lat: 43.65 }));
    advance(1000); engine.onFix(fix({ speedMs: 40, lat: 43.6505, ts: advance(0) }));
    advance(1000); engine.onFix(fix({ speedMs: 10, lat: 43.651, ts: advance(0) }));
    expect(engine.segment.maxKmh).toBeCloseTo(144);
    expect(engine.segment.distanceM).toBeGreaterThan(100);
    // Still driving: a fresh fix arrives before each tick.
    advance(TICK_MS);
    engine.onFix(fix({ speedMs: 10, lat: 43.6515, ts: advance(0) }));
    expect(log.checkpoints.length).toBe(0);
    advance(TICK_MS);
    engine.onFix(fix({ speedMs: 10, lat: 43.652, ts: advance(0) }));
    await Promise.resolve();
    expect(log.checkpoints.length).toBe(1);
    expect(log.checkpoints[0].speed).toBeCloseTo(144);
  });

  it("sends a values-free heartbeat every tick while stationary", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    await engine.maybeTick(advance(TICK_MS));
    await engine.maybeTick(advance(TICK_MS));
    expect(log.checkpoints).toEqual([{ id: "s1", speed: null, dist: null }, { id: "s1", speed: null, dist: null }]);
  });

  it("ticks from fixes too, so a throttled timer cannot stall the session", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    advance(TICK_MS + 1);
    engine.onFix(fix({ speedMs: 0, ts: advance(0) }));
    await Promise.resolve();
    expect(log.checkpoints.length).toBe(1);
  });

  it("resets the segment at the Toronto week boundary and never carries the max over", async () => {
    const { engine, advance, fix } = setup();
    await engine.start(["a"]);
    const before = Date.parse("2025-10-13T03:59:50Z");
    engine.onFix(fix({ speedMs: 60, ts: before }));
    expect(engine.segment).toMatchObject({ week: "2025-10-06" });
    expect(engine.segment.maxKmh).toBeCloseTo(216);
    engine.onFix(fix({ speedMs: 10, ts: Date.parse("2025-10-13T04:00:10Z") }));
    expect(engine.segment.week).toBe("2025-10-13");
    expect(engine.segment.maxKmh).toBeCloseTo(36);
    advance(0);
  });

  it("ignores GPS jumps when adding distance", async () => {
    const { engine, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ lat: 43.65 }));
    engine.onFix(fix({ lat: 44.65, ts: Date.now() }));
    expect(engine.segment.distanceM).toBe(0);
  });

  it("starts a new session when the server says the old one is gone", async () => {
    let calls = 0;
    const { engine, log, advance, fix } = setup({
      checkpoint: async () => { calls++; if (calls === 1) throw new Error("session_not_found"); return "2025-10-06"; },
    });
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    await engine.maybeTick(advance(TICK_MS));
    expect(log.started.length).toBe(2);
    expect(engine.sessionId).toBe("s2");
  });

  it("stop broadcasts a stop event, clears the self position, writes a final checkpoint, and ends the session", async () => {
    const { engine, log, fix } = setup();
    await engine.start(["a", "b"]);
    engine.onFix(fix({ speedMs: 30 }));
    const before = log.broadcasts.filter((b) => b.event === "pos").length;
    expect(before).toBe(2);
    await engine.stop();
    expect(log.broadcasts.filter((b) => b.event === "stop").map((b) => b.crew)).toEqual(["a", "b"]);
    expect(log.self.at(-1)).toBeNull();
    expect(log.checkpoints.at(-1).speed).toBeCloseTo(108);
    expect(log.ended).toEqual(["s1"]);
    expect(engine.isLive).toBe(false);
    engine.onFix(fix());
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(before);
  });
});

describe("LiveEngine: review fixes", () => {
  it("treats a member as parked when fixes stop arriving, even if the last fix was fast", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 25 }));
    expect(engine.isMoving).toBe(true);
    advance(20000);
    engine.rebroadcast(advance(0));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(2);
    await engine.maybeTick(advance(TICK_MS));
    expect(log.checkpoints.at(-1)).toEqual({ id: "s1", speed: null, dist: null });
  });

  it("writes the old week's final values to the old week before starting the new one from zero", async () => {
    const calls: any[] = [];
    const { engine, fix } = setup({
      checkpoint: async (id, speed, dist, week) => {
        calls.push({ id, speed, dist, week });
        return "2025-10-13";
      },
    });
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 50, ts: Date.parse("2025-10-13T03:59:50Z") }));
    engine.onFix(fix({ speedMs: 10, ts: Date.parse("2025-10-13T04:00:05Z") }));
    await Promise.resolve();
    expect(calls[0].week).toBe("2025-10-06");
    expect(calls[0].speed).toBeCloseTo(180);
    expect(engine.segment.week).toBe("2025-10-13");
    expect(engine.segment.maxKmh).toBeCloseTo(36);
  });

  it("ignores speed and distance from very imprecise fixes but still shows the position", async () => {
    const { engine, log, fix, now } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 20, accuracy: 5 }));
    engine.onFix(fix({ speedMs: 90, accuracy: 400, lat: 43.66, ts: now() + 1000 }));
    expect(engine.segment.maxKmh).toBeCloseTo(72);
    expect(log.self.length).toBe(2);
  });
});

describe("LiveEngine: parked drivers, dropped crews, and races", () => {
  it("keeps broadcasting a parked member's last position on the stationary interval", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(1);
    advance(10000);
    engine.rebroadcast(advance(0));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(1);
    advance(6000);
    engine.rebroadcast(advance(0));
    const pos = log.broadcasts.filter((b) => b.event === "pos");
    expect(pos.length).toBe(2);
    expect(pos[1]!.payload.ts).toBe(advance(0));
    expect(pos[1]!.payload.lat).toBe(43.65);
  });

  it("does not rebroadcast while moving or after stop", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 20 }));
    advance(4000);
    engine.rebroadcast(advance(0));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(1);
    await engine.stop();
    advance(30000);
    engine.rebroadcast(advance(0));
    expect(log.broadcasts.filter((b) => b.event === "pos").length).toBe(1);
  });

  it("stops sharing with crews that were dropped and tells them", async () => {
    const { engine, log, advance, fix } = setup();
    await engine.start(["a", "b"]);
    expect(engine.dropCrews(["a"])).toEqual(["b"]);
    expect(log.broadcasts.filter((b) => b.event === "stop").map((b) => b.crew)).toEqual(["a"]);
    engine.onFix(fix({ speedMs: 20 }));
    expect(log.broadcasts.filter((b) => b.event === "pos").map((b) => b.crew)).toEqual(["b"]);
    advance(0);
  });

  it("closes a session that was restarted after the person already stopped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let starts = 0;
    const { engine, log, advance, fix } = setup({
      startSession: async () => {
        starts++;
        if (starts === 2) await gate;
        return `s${starts}`;
      },
      checkpoint: async () => { throw new Error("session_not_found"); },
    });
    await engine.start(["a"]);
    engine.onFix(fix({ speedMs: 0 }));
    const tick = engine.maybeTick(advance(TICK_MS));
    await Promise.resolve();
    await engine.stop();
    release();
    await tick;
    expect(engine.sessionId).toBeNull();
    expect(log.ended).toContain("s2");
  });
});
