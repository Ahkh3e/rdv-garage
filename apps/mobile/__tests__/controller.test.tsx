import { createStore } from "@rdv/core/store";
import { createEvents } from "@rdv/core/events";
import { createController } from "@rdv/live-location/controller";

const Location = require("expo-location");

function setup() {
  const calls: { name: string; args: any }[] = [];
  const acquired: string[] = [];
  const released: string[] = [];
  const hub: any = {
    acquire: (id: string) => {
      acquired.push(id);
      return () => released.push(id);
    },
    send: jest.fn(),
    track: jest.fn(),
    untrack: jest.fn(),
  };
  let sessions = 0;
  const live = createStore<any>({ live: false, sessionId: null, crewIds: [] });
  const session = createStore<any>({ status: "signedIn", userId: "me", profile: { handle: "me" } });
  const crews = createStore<any>({ loaded: true, crews: [{ id: "a", name: "A" }, { id: "b", name: "B" }], selected: ["a", "b"] });
  const events = createEvents();
  const shell: any = {
    backend: {
      rpc: jest.fn(async (schema: string, name: string, args: any) => {
        calls.push({ name: `${schema}.${name}`, args });
        if (name === "start_session") return `s${++sessions}`;
        if (name === "checkpoint_session") return "2025-10-06";
        return null;
      }),
    },
    session, live, events,
    crewContext: { store: crews },
    locationStream: { publish: jest.fn(), remove: jest.fn() },
  };
  return { shell, hub, calls, acquired, released, live, crews, session, events };
}

describe("live controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Location.startLocationUpdatesAsync.mockImplementation(async () => undefined);
  });

  it("starts, marks the app live, and ends the server session on stop", async () => {
    const t = setup();
    const c = createController(t.shell, t.hub);
    expect(await c.goLive(["a", "b"])).toBe("ok");
    expect(t.live.get()).toMatchObject({ live: true, sessionId: "s1", crewIds: ["a", "b"] });
    expect(t.acquired).toEqual(["a", "b"]);
    await c.stop();
    expect(t.live.get()).toEqual({ live: false, sessionId: null, crewIds: [] });
    expect(t.calls.some((x) => x.name === "live.end_session" && x.args.p_session === "s1")).toBe(true);
    expect(t.released.sort()).toEqual(["a", "b"]);
  });

  it("closes the server session and releases channels when the location service fails to start", async () => {
    const t = setup();
    Location.startLocationUpdatesAsync.mockRejectedValueOnce(new Error("foreground service refused"));
    const c = createController(t.shell, t.hub);
    await expect(c.goLive(["a"])).rejects.toThrow("foreground service refused");
    expect(t.calls.some((x) => x.name === "live.end_session" && x.args.p_session === "s1")).toBe(true);
    expect(t.released).toEqual(["a"]);
    expect(t.live.get().live).toBe(false);
    // And it can start again afterwards.
    expect(await c.goLive(["a"])).toBe("ok");
    await c.stop();
  });

  it("ignores a second Go live while one is starting or running", async () => {
    const t = setup();
    const c = createController(t.shell, t.hub);
    const [first, second] = await Promise.all([c.goLive(["a"]), c.goLive(["a"])]);
    expect([first, second].sort()).toEqual(["denied", "ok"]);
    expect(t.calls.filter((x) => x.name === "live.start_session").length).toBe(1);
    expect(await c.goLive(["a"])).toBe("denied");
    await c.stop();
  });

  it("stops sharing with a crew the person leaves, but keeps sharing with the others", async () => {
    const t = setup();
    const c = createController(t.shell, t.hub);
    await c.goLive(["a", "b"]);
    t.crews.set((s: any) => ({ ...s, crews: s.crews.filter((x: any) => x.id !== "a") }));
    expect(c.liveCrews()).toEqual(["b"]);
    expect(t.released).toEqual(["a"]);
    expect(t.live.get().crewIds).toEqual(["b"]);
    expect(t.hub.send).toHaveBeenCalledWith("a", "stop", expect.objectContaining({ user_id: "me" }));
    await c.stop();
  });

  it("stops entirely when the last live crew is gone", async () => {
    const t = setup();
    const c = createController(t.shell, t.hub);
    await c.goLive(["a"]);
    t.crews.set((s: any) => ({ ...s, crews: s.crews.filter((x: any) => x.id !== "a") }));
    await new Promise((r) => setTimeout(r, 10));
    expect(t.live.get().live).toBe(false);
    expect(t.calls.some((x) => x.name === "live.end_session")).toBe(true);
  });

  it("stops when the person signs out or is suspended", async () => {
    const t = setup();
    const c = createController(t.shell, t.hub);
    await c.goLive(["a"]);
    t.session.set({ status: "signedOut" });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.live.get().live).toBe(false);

    t.session.set({ status: "signedIn", userId: "me", profile: { handle: "me" } });
    await c.goLive(["a"]);
    t.events.emit({ type: "account.suspended" });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.live.get().live).toBe(false);
  });

  it("does not go live when the location permission is not granted", async () => {
    const t = setup();
    Location.getBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    Location.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ status: "denied" });
    const { Alert } = require("react-native");
    jest.spyOn(Alert, "alert").mockImplementation((_t: any, _m: any, buttons: any) => buttons?.[1]?.onPress?.());
    const c = createController(t.shell, t.hub);
    expect(await c.goLive(["a"])).toBe("foreground_only");
    expect(t.calls.filter((x) => x.name === "live.start_session").length).toBe(0);
  });
});
