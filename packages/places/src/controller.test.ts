import { describe, expect, it, vi } from "vitest";
import type { CrewContextState, Poi, SessionState } from "@rdv/core";
import { createMapBridge } from "@rdv/core/mapBridge";
import { createStore } from "@rdv/core/store";
import { createPlacesController, type ControllerShell } from "./controller";

const crew = (id: string, role: "owner" | "member", styleIndex: number) => ({ id, role, styleIndex, selected: true }) as never;

function setup(over: { routes?: string[]; pois?: Poi[]; rows?: unknown[] } = {}) {
  const rpc = vi.fn(async (_schema: string, name: string, _args?: unknown) => {
    if (name === "list_pins") return over.rows ?? [];
    if (name === "drop_pin") return "new-pin";
    return undefined;
  });
  const bridge = createMapBridge();
  bridge.attach({ queryPois: async () => over.pois ?? [], flyTo: vi.fn() });
  bridge.setView({ lat: 43.65, lng: -79.38, zoom: 15 });
  const crewStore = createStore<CrewContextState>({ loaded: true, crews: [crew("c1", "owner", 2)], selected: ["c1"] });
  const navigate = vi.fn();
  const openDirections = vi.fn(async () => undefined);
  const shell = {
    backend: { rpc } as never,
    mapBridge: bridge,
    crewContext: { store: crewStore } as never,
    session: createStore<SessionState>({ status: "signedIn", userId: "u1", profile: { id: "u1", handle: "me", avatarPath: null, carIcon: "gt" } }),
    navigate,
    handoff: { openDirections },
    hasRoute: (name: string) => (over.routes ?? []).includes(name),
  } satisfies ControllerShell;
  const controller = createPlacesController(shell, () => Date.parse("2025-10-07T10:00:00Z"));
  return { controller, rpc, navigate, openDirections, bridge, crewStore };
}

const row = { id: "p1", dropper_id: "u2", dropper_handle: "ace", label: "Meet", note: "Bring snacks", address: null, lat: 43.7, lng: -79.4, expires_at: "2025-10-07T12:00:00Z", crew_ids: ["c1"] };

describe("places controller", () => {
  it("loads pins for the selected crews and registers them as pin-kind map pins in the crew colour", async () => {
    const { controller, rpc } = setup({ rows: [row] });
    await controller.refreshPins();
    expect(rpc).toHaveBeenCalledWith("places", "list_pins", { p_crew_ids: ["c1"] });
    expect(controller.pins.get()).toMatchObject([{ kind: "pin", label: "Meet", colorKey: 2 }]);
    controller.pins.get()[0]!.onPress();
    expect(controller.selectedPin()?.id).toBe("p1");
    expect(controller.canRemove(controller.selectedPin()!)).toBe(true);
  });

  it("does not ask the server when no crew is selected", async () => {
    const { controller, rpc, crewStore } = setup({ rows: [row] });
    crewStore.set((s) => ({ ...s, selected: [] }));
    await controller.refreshPins();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("drops a pin with trimmed values and selects it", async () => {
    const { controller, rpc } = setup({ rows: [{ ...row, id: "new-pin" }] });
    controller.startDrop({ name: "Tim Hortons", kind: "Cafe", address: "10 Queen St", lat: 43.65, lng: -79.38 });
    expect(controller.state.get().draft).toMatchObject({ label: "Tim Hortons", address: "10 Queen St" });
    await controller.drop({ label: "  Coffee run ", note: "  ", crewIds: ["c1"] });
    expect(rpc).toHaveBeenCalledWith("places", "drop_pin", { p_label: "Coffee run", p_note: null, p_lat: 43.65, p_lng: -79.38, p_address: "10 Queen St", p_crew_ids: ["c1"] });
    expect(controller.state.get().draft).toBeNull();
    expect(controller.state.get().selection).toEqual({ kind: "pin", pinId: "new-pin" });
  });

  it("starts a drop from a long press with a default label", () => {
    const { controller } = setup();
    controller.startDrop({ lat: 43.1, lng: -79.1 });
    expect(controller.state.get().draft).toEqual({ point: { lat: 43.1, lng: -79.1 }, address: null, label: "Dropped pin" });
  });

  it("removes a pin and clears its card", async () => {
    const { controller, rpc } = setup({ rows: [row] });
    await controller.refreshPins();
    controller.selectPin("p1");
    await controller.removePin("p1");
    expect(rpc).toHaveBeenCalledWith("places", "remove_pin", { p_pin: "p1" });
    expect(controller.state.get().pins).toEqual([]);
    expect(controller.state.get().selection).toBeNull();
  });

  it("lists nearby places from the tiles by distance and shows them on the map", async () => {
    const pois: Poi[] = [
      { name: "Far Gas", lat: 43.7, lng: -79.38, cls: "fuel", subclass: null },
      { name: "Near Gas", lat: 43.651, lng: -79.38, cls: "fuel", subclass: null },
    ];
    const { controller, rpc } = setup({ pois });
    await controller.showNearby("fuel");
    expect(controller.state.get().nearby!.results.map((r) => r.place.name)).toEqual(["Near Gas", "Far Gas"]);
    expect(controller.pins.get().map((p) => p.kind)).toEqual(["place", "place"]);
    expect(rpc).not.toHaveBeenCalled();
    controller.clearNearby();
    expect(controller.pins.get()).toEqual([]);
  });

  it("asks to zoom in when the map is too far out for place data", async () => {
    const { controller, bridge } = setup();
    bridge.setView({ lat: 43.65, lng: -79.38, zoom: 9 });
    await controller.showNearby("food");
    expect(controller.state.get().nearby).toMatchObject({ hint: "zoom", results: [] });
  });

  it("hands directions to the shell with the place label only", async () => {
    const { controller, openDirections } = setup();
    await controller.directions({ name: "Spot", lat: 1, lng: 2 });
    expect(openDirections).toHaveBeenCalledWith({ lat: 1, lng: 2, label: "Spot" });
  });

  it("offers Make an RDV only when the create route is registered", () => {
    const none = setup();
    expect(none.controller.canMakeRdv()).toBe(false);
    none.controller.makeRdv({ name: "Spot", kind: "Pin", address: null, lat: 1, lng: 2 });
    expect(none.navigate).not.toHaveBeenCalled();
    const some = setup({ routes: ["RdvCreate"] });
    expect(some.controller.canMakeRdv()).toBe(true);
    const place = { name: "Spot", kind: "Pin", address: null, lat: 1, lng: 2 };
    some.controller.makeRdv(place);
    expect(some.navigate).toHaveBeenCalledWith("RdvCreate", { place });
  });

  it("resolves a place picker with the chosen place or null", async () => {
    const { controller, navigate } = setup();
    const place = { name: "Spot", kind: "Pin", address: null, lat: 1, lng: 2 };
    const picked = controller.pickPlace();
    expect(navigate).toHaveBeenCalledWith("PlacePicker");
    controller.finishPick(place);
    expect(await picked).toBe(place);
    const dismissed = controller.pickPlace();
    controller.finishPick(null);
    expect(await dismissed).toBeNull();
  });
});
