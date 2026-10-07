import { describe, expect, it, vi } from "vitest";
import type { CrewContextState, MemberPosition, SessionState } from "@rdv/core";
import { AppError } from "@rdv/core/errors";
import { createStore } from "@rdv/core/store";
import { createRdvsController, type ReminderStore } from "./controller";
import { emptyDraft } from "./draft";

const NOW = Date.parse("2026-06-10T22:00:00Z");
const H = 3600000;
const iso = (ms: number) => new Date(ms).toISOString();

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1", host_id: "u2", host_handle: "ace", title: "Sunday meet", kind: "meet", area_name: "Waterfront", starts_at: iso(NOW - 10 * 60000), ends_at: null, end_at: iso(NOW + 170 * 60000),
  radius_m: 150, note: null, status: "scheduled", crew_ids: ["c1"], place: { name: "Harbour lot", lat: 43.65, lng: -79.38 }, going: 1, maybe: 0, cant: 0, my_answer: null, arrived: false, ...over,
});

function setup(rows: unknown[] = [row()], over: { invoke?: (name: string, body: unknown) => unknown; permitted?: boolean } = {}) {
  const rpc = vi.fn(async (_schema: string, name: string, _args?: unknown) => {
    if (name === "list_rdvs") return rows;
    if (name === "create_rdv") return "new";
    if (name === "list_rsvps") return [{ user_id: "u2", handle: "ace", avatar_path: null, answer: "going", arrived: true }];
    return undefined;
  });
  const invoke = vi.fn(async (name: string, body: unknown) => (over.invoke ? over.invoke(name, body) : { recorded: true }));
  const crewStore = createStore<CrewContextState>({
    loaded: true,
    crews: [{ id: "c1", role: "owner", styleIndex: 3, selected: true }, { id: "c2", role: "member", styleIndex: 1, selected: false }] as never,
    selected: ["c1"],
  });
  const positions = createStore<Record<string, MemberPosition>>({});
  const navigate = vi.fn();
  const openDirections = vi.fn(async () => undefined);
  const scheduled = new Map<string, { key: string; at: number; title?: string; body?: string }>();
  const permitted = vi.fn(async () => over.permitted ?? true);
  const reminders: ReminderStore = {
    permitted,
    list: async () => [...scheduled.values()],
    schedule: async (r) => void scheduled.set(r.key, r),
    cancel: async (key) => void scheduled.delete(key),
  };
  const readPosition = vi.fn(async () => ({ lat: 43.65, lng: -79.38 }));
  let now = NOW;
  const shell = {
    backend: { rpc, invoke } as never,
    crewContext: { store: crewStore } as never,
    session: createStore<SessionState>({ status: "signedIn", userId: "u1", profile: { id: "u1", handle: "me", avatarPath: null, carIcon: "gt" } }),
    locationStream: { store: positions } as never,
    navigate,
    handoff: { openDirections },
  };
  const controller = createRdvsController(shell, { reminders, readPosition, now: () => now });
  return { shell, controller, rpc, invoke, crewStore, positions, navigate, openDirections, scheduled, readPosition, permitted, setNow: (n: number) => (now = n) };
}

const here = (over: Partial<MemberPosition> = {}): Record<string, MemberPosition> => ({
  u1: { userId: "u1", crewIds: ["c1"], lat: 43.65, lng: -79.38, heading: null, ts: NOW, ...over },
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("rdvs controller", () => {
  it("loads RDVs for all the person's crews and pins those of the selected crews", async () => {
    const { controller, rpc } = setup([row(), row({ id: "r2", crew_ids: ["c2"] })]);
    await controller.refresh();
    expect(rpc).toHaveBeenCalledWith("rdvs", "list_rdvs", { p_crew_ids: ["c1", "c2"] });
    expect(controller.state.get().rdvs).toHaveLength(2);
    expect(controller.forSelectedCrews().map((r) => r.id)).toEqual(["r1"]);
    expect(controller.pins.get()).toMatchObject([{ id: "r1", kind: "rdv", label: "Sunday meet", colorKey: 3, live: true }]);
  });

  it("opens the detail when a pin is pressed", async () => {
    const { controller, navigate } = setup();
    await controller.refresh();
    controller.pins.get()[0]!.onPress();
    expect(navigate).toHaveBeenCalledWith("RdvDetail", { id: "r1" });
  });

  it("changes the pins with the selected crews and drops a cancelled RDV", async () => {
    const { controller, crewStore } = setup([row(), row({ id: "r3", status: "cancelled" })]);
    await controller.refresh();
    expect(controller.pins.get().map((p) => p.id)).toEqual(["r1"]);
    crewStore.set((s) => ({ ...s, selected: ["c2"] }));
    expect(controller.pins.get()).toEqual([]);
  });

  it("has no pin for a private event whose place is withheld", async () => {
    const { controller } = setup([row({ kind: "private_event", place: null })]);
    await controller.refresh();
    expect(controller.pins.get()).toEqual([]);
    expect(controller.state.get().rdvs[0]!.place).toBeNull();
  });

  it("creates with the draft arguments and refreshes", async () => {
    const { controller, rpc } = setup();
    const draft = { ...emptyDraft({ name: "Lot", kind: "Park", address: "1 Main St, Toronto", lat: 43.6, lng: -79.3 }, ["c1"], NOW), title: "Night cruise", kind: "cruise" as const };
    expect(await controller.create(draft)).toBe("new");
    expect(rpc).toHaveBeenCalledWith("rdvs", "create_rdv", expect.objectContaining({ p_title: "Night cruise", p_kind: "cruise", p_area_name: "Toronto", p_crew_ids: ["c1"] }));
    expect(rpc.mock.calls.filter((c) => c[1] === "list_rdvs")).toHaveLength(1);
  });

  it("answers, cancels and lists who answered", async () => {
    const { controller, rpc } = setup();
    await controller.setRsvp("r1", "going");
    expect(rpc).toHaveBeenCalledWith("rdvs", "set_rsvp", { p_rdv: "r1", p_answer: "going" });
    await controller.cancel("r1");
    expect(rpc).toHaveBeenCalledWith("rdvs", "cancel_rdv", { p_rdv: "r1" });
    expect(await controller.people("r1")).toEqual([{ userId: "u2", handle: "ace", avatarPath: null, answer: "going", arrived: true }]);
  });

  it("reads the person's own meets attended from the server", async () => {
    const { controller, rpc } = setup();
    await controller.meetsAttended();
    expect(rpc).toHaveBeenCalledWith("rdvs", "my_meets_attended");
  });

  it("hands directions to the maps app for a visible place only", async () => {
    const { controller, openDirections } = setup([row(), row({ id: "p", kind: "private_event", place: null })]);
    await controller.refresh();
    await controller.directions(controller.find("r1")!);
    expect(openDirections).toHaveBeenCalledWith({ lat: 43.65, lng: -79.38, label: "Harbour lot" });
    expect(() => controller.directions(controller.find("p")!)).toThrow(AppError);
  });
});

describe("arrival", () => {
  it("records a live member's arrival once, with the one reading, when they are inside the radius in the window", async () => {
    const { controller, invoke, positions } = setup();
    await controller.refresh();
    positions.set(here());
    await tick();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("record_arrival", { rdv_id: "r1", position: { lat: 43.65, lng: -79.38 }, method: "live" });
    positions.set(here({ ts: NOW + 1000 }));
    positions.set(here({ ts: NOW + 2000 }));
    await tick();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("sends only the coordinates of the reading", async () => {
    const { controller, invoke, positions } = setup();
    await controller.refresh();
    positions.set(here({ heading: 90, speedKmh: 55 }));
    await tick();
    expect(Object.keys((invoke.mock.calls[0]![1] as { position: object }).position).sort()).toEqual(["lat", "lng"]);
  });

  it("does not call when outside the radius, outside the window, already arrived, or not live to the RDV's crew", async () => {
    const outside = setup();
    await outside.controller.refresh();
    outside.positions.set(here({ lat: 43.7 }));
    const early = setup([row({ starts_at: iso(NOW + 3 * H), end_at: iso(NOW + 6 * H) })]);
    await early.controller.refresh();
    early.positions.set(here());
    const done = setup([row({ arrived: true })]);
    await done.controller.refresh();
    done.positions.set(here());
    const other = setup();
    await other.controller.refresh();
    other.positions.set(here({ crewIds: ["c2"] }));
    await tick();
    for (const s of [outside, early, done, other]) expect(s.invoke).not.toHaveBeenCalled();
  });

  it("does not use anyone else's position", async () => {
    const { controller, invoke, positions } = setup();
    await controller.refresh();
    positions.set({ u9: { userId: "u9", crewIds: ["c1"], lat: 43.65, lng: -79.38, heading: null, ts: NOW } });
    await tick();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("retries after the server says the reading is outside the radius or window, but not when the RDV is closed", async () => {
    for (const code of ["outside_radius", "outside_window"]) {
      const refused = setup([row()], { invoke: () => { throw new AppError(code); } });
      await refused.controller.refresh();
      refused.positions.set(here());
      await tick();
      refused.positions.set(here({ ts: NOW + 1000 }));
      await tick();
      expect(refused.invoke).toHaveBeenCalledTimes(1);
      refused.setNow(NOW + 61000);
      refused.positions.set(here({ ts: NOW + 61000 }));
      await tick();
      expect(refused.invoke).toHaveBeenCalledTimes(2);
    }

    const closed = setup([row()], { invoke: () => { throw new AppError("rdv_closed"); } });
    await closed.controller.refresh();
    closed.positions.set(here());
    await tick();
    closed.setNow(NOW + 5 * 60000);
    closed.positions.set(here({ ts: NOW + 5 * 60000 }));
    await tick();
    expect(closed.invoke).toHaveBeenCalledTimes(1);
  });

  it("gives up live detection for an RDV after three attempts, backing off between them", async () => {
    const s = setup([row()], { invoke: () => { throw new AppError("outside_radius"); } });
    await s.controller.refresh();
    const at = (ms: number) => { s.setNow(NOW + ms); s.positions.set(here({ ts: NOW + ms })); return tick(); };
    await at(0);
    await at(61000);
    await at(100000);
    expect(s.invoke).toHaveBeenCalledTimes(2);
    await at(61000 + 121000);
    expect(s.invoke).toHaveBeenCalledTimes(3);
    await at(61000 + 121000 + 500000);
    expect(s.invoke).toHaveBeenCalledTimes(3);
  });

  it("stops live detection when rate limited, and I'm here still works", async () => {
    const s = setup([row(), row({ id: "r2" })], { invoke: (_n, body) => { if ((body as { method: string }).method === "live") throw new AppError("rate_limited"); return { recorded: true }; } });
    await s.controller.refresh();
    s.positions.set(here());
    await tick();
    expect(s.invoke).toHaveBeenCalledTimes(2);
    s.setNow(NOW + 600000);
    s.positions.set(here({ ts: NOW + 600000 }));
    await tick();
    expect(s.invoke).toHaveBeenCalledTimes(2);
    await s.controller.markHere("r1");
    expect(s.invoke).toHaveBeenCalledTimes(3);
  });

  it("retries after a network error at the retry interval", async () => {
    const flaky = setup([row()], { invoke: () => { throw new AppError("network"); } });
    await flaky.controller.refresh();
    flaky.positions.set(here());
    await tick();
    flaky.positions.set(here({ ts: NOW + 1000 }));
    await tick();
    expect(flaky.invoke).toHaveBeenCalledTimes(1);
    flaky.setNow(NOW + 61000);
    flaky.positions.set(here({ ts: NOW + 61000 }));
    await tick();
    expect(flaky.invoke).toHaveBeenCalledTimes(2);
  });

  it("takes one reading for I'm here and surfaces the server's refusal", async () => {
    const ok = setup();
    await ok.controller.markHere("r1");
    expect(ok.readPosition).toHaveBeenCalledTimes(1);
    expect(ok.invoke).toHaveBeenCalledWith("record_arrival", { rdv_id: "r1", position: { lat: 43.65, lng: -79.38 }, method: "here" });

    const far = setup([row()], { invoke: () => { throw new AppError("outside_radius"); } });
    await expect(far.controller.markHere("r1")).rejects.toMatchObject({ code: "outside_radius" });
  });
});

describe("reminders", () => {
  it("schedules going and maybe, and cancels when the answer changes or the RDV is cancelled", async () => {
    const future = { starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H) };
    const { controller, scheduled, rpc } = setup([row({ id: "a", my_answer: "going", ...future }), row({ id: "b", my_answer: "cant", ...future })]);
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual(["rdv-a"]);
    expect(scheduled.get("rdv-a")!.at).toBe(NOW + 4 * H);

    rpc.mockImplementation(async (_s: string, name: string) => (name === "list_rdvs" ? [row({ id: "a", my_answer: "cant", ...future })] : undefined));
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual([]);

    rpc.mockImplementation(async (_s: string, name: string) => (name === "list_rdvs" ? [row({ id: "a", my_answer: "maybe", ...future })] : undefined));
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual(["rdv-a"]);
    rpc.mockImplementation(async (_s: string, name: string) => (name === "list_rdvs" ? [row({ id: "a", my_answer: "maybe", status: "cancelled", ...future })] : undefined));
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual([]);
  });

  it("checks the permission once per sync and skips a sync when nothing changed", async () => {
    const future = { starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H), my_answer: "going" };
    const { controller, permitted, scheduled } = setup([row(future)]);
    await controller.refresh();
    await tick();
    expect(permitted).toHaveBeenCalledTimes(1);
    expect(scheduled.size).toBe(1);
    await controller.refresh();
    await controller.refresh();
    await tick();
    expect(permitted).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing and does not ask again every cycle when notifications are not permitted", async () => {
    const future = { starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H), my_answer: "going" };
    const { controller, permitted, scheduled } = setup([row(future)], { permitted: false });
    await controller.refresh();
    await controller.refresh();
    await controller.refresh();
    await tick();
    expect(scheduled.size).toBe(0);
    expect(permitted).toHaveBeenCalledTimes(1);
  });

  it("keeps reminders while crews have not loaded, and clears them once crews load empty or the person signs out", async () => {
    const { controller, scheduled, crewStore } = setup([row({ id: "a", my_answer: "going", starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H) })]);
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual(["rdv-a"]);

    crewStore.set({ loaded: false, crews: [], selected: [] });
    await controller.refresh();
    await tick();
    expect([...scheduled.keys()]).toEqual(["rdv-a"]);
    expect(controller.state.get().rdvs).toHaveLength(1);

    crewStore.set({ loaded: true, crews: [], selected: [] });
    await controller.refresh();
    await tick();
    expect(scheduled.size).toBe(0);
  });

  it("clears reminders when nobody is signed in", async () => {
    const { controller, scheduled, shell } = setup([row({ id: "a", my_answer: "going", starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H) })]);
    await controller.refresh();
    await tick();
    expect(scheduled.size).toBe(1);
    shell.session.set({ status: "signedOut" });
    await controller.refresh();
    await tick();
    expect(scheduled.size).toBe(0);
  });

  it("reschedules when the start changes and clears everything on reset", async () => {
    const { controller, scheduled, rpc } = setup([row({ id: "a", my_answer: "going", starts_at: iso(NOW + 5 * H), end_at: iso(NOW + 8 * H) })]);
    await controller.refresh();
    await tick();
    const first = scheduled.get("rdv-a")!.at;
    rpc.mockImplementation(async (_s: string, name: string) => (name === "list_rdvs" ? [row({ id: "a", my_answer: "going", starts_at: iso(NOW + 6 * H), end_at: iso(NOW + 9 * H) })] : undefined));
    await controller.refresh();
    await tick();
    expect(scheduled.get("rdv-a")!.at).toBe(first + H);
    controller.reset();
    await tick();
    expect(scheduled.size).toBe(0);
  });
});
