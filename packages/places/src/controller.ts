import type { CrewId, GeoPoint, MapPin, Place, Shell } from "@rdv/core";
import { RDV_CREATE_ROUTE } from "@rdv/core/places";
import { createStore, type Store } from "@rdv/core/store";
import { nearby, type CategoryId, type NearbyResult } from "./categories";
import { canRemove, pinFromRow, placeOfPin, toMapPin, toPlacePin, unexpired, type Pin, type PinRow } from "./pins";
import { defaultLabel } from "./validation";

export type Selection = { kind: "place"; place: Place } | { kind: "pin"; pinId: string };

export interface Draft {
  point: GeoPoint;
  address: string | null;
  label: string;
}

export interface PlacesState {
  pins: Pin[];
  selection: Selection | null;
  nearby: { category: CategoryId; results: NearbyResult[]; hint: "zoom" | null } | null;
  draft: Draft | null;
}

export type ControllerShell = Pick<Shell, "backend" | "mapBridge" | "crewContext" | "session" | "navigate" | "handoff" | "hasRoute">;

export const NEARBY_MIN_ZOOM = 13;
export const REFRESH_MS = 30000;
export const PICKER_ROUTE = "PlacePicker";

export interface DropInput {
  label: string;
  note: string;
  crewIds: CrewId[];
}

export function createPlacesController(shell: ControllerShell, now: () => number = Date.now) {
  const state = createStore<PlacesState>({ pins: [], selection: null, nearby: null, draft: null });
  const mapPins = createStore<MapPin[]>([]);
  let seq = 0;
  let picking: ((place: Place | null) => void) | null = null;

  const userId = () => {
    const session = shell.session.get();
    return session.status === "signedIn" ? session.userId : null;
  };

  const selectedPin = () => {
    const { selection, pins } = state.get();
    return selection?.kind === "pin" ? pins.find((pin) => pin.id === selection.pinId) ?? null : null;
  };

  const sync = () => {
    const { pins, nearby: near, selection } = state.get();
    const crews = shell.crewContext.store.get().crews;
    const next: MapPin[] = unexpired(pins, now()).map((pin) => toMapPin(pin, crews, () => controller.selectPin(pin.id)));
    if (near) near.results.forEach((r, i) => next.push(toPlacePin(`n${i}`, r.place, () => controller.selectPlace(r.place))));
    if (selection?.kind === "place" && !near?.results.some((r) => r.place === selection.place)) {
      next.push(toPlacePin("selected", selection.place, () => controller.selectPlace(selection.place as Place)));
    }
    mapPins.set(next);
  };
  state.subscribe(sync);
  shell.crewContext.store.subscribe(sync);

  const controller = {
    state,
    pins: mapPins as Store<MapPin[]>,
    selectedPin,

    async refreshPins() {
      const mine = ++seq;
      const crewIds = shell.crewContext.store.get().selected;
      if (crewIds.length === 0 || !userId()) return state.set((s) => (s.pins.length ? { ...s, pins: [] } : s));
      try {
        const rows = await shell.backend.rpc<PinRow[]>("places", "list_pins", { p_crew_ids: crewIds });
        if (mine !== seq) return;
        state.set((s) => ({ ...s, pins: unexpired(rows.map(pinFromRow), now()) }));
      } catch {
        // Keep what is on the map; the next refresh tries again.
      }
    },

    start() {
      void controller.refreshPins();
      const timer = setInterval(() => void controller.refreshPins(), REFRESH_MS);
      let selected = shell.crewContext.store.get().selected;
      const off = shell.crewContext.store.subscribe(() => {
        const next = shell.crewContext.store.get().selected;
        if (next === selected) return;
        selected = next;
        void controller.refreshPins();
      });
      return () => {
        clearInterval(timer);
        off();
        controller.reset();
      };
    },

    reset() {
      seq++;
      state.set({ pins: [], selection: null, nearby: null, draft: null });
    },

    selectPlace(place: Place) {
      state.set((s) => ({ ...s, selection: { kind: "place", place } }));
    },

    openPlace(place: Place) {
      controller.selectPlace(place);
      shell.mapBridge.flyTo(place);
    },

    selectPin(pinId: string) {
      state.set((s) => ({ ...s, selection: { kind: "pin", pinId } }));
    },

    clearSelection() {
      state.set((s) => ({ ...s, selection: null }));
    },

    async showNearby(category: CategoryId) {
      const view = shell.mapBridge.view.get();
      if (!view) return;
      if (view.zoom < NEARBY_MIN_ZOOM) return state.set((s) => ({ ...s, nearby: { category, results: [], hint: "zoom" } }));
      const pois = await shell.mapBridge.pois();
      state.set((s) => ({ ...s, nearby: { category, results: nearby(pois, category, view), hint: null } }));
    },

    clearNearby() {
      state.set((s) => ({ ...s, nearby: null }));
    },

    startDrop(target: Place | GeoPoint) {
      const place = "name" in target ? target : null;
      state.set((s) => ({ ...s, draft: { point: { lat: target.lat, lng: target.lng }, address: place?.address ?? null, label: defaultLabel(place) } }));
    },

    cancelDrop() {
      state.set((s) => ({ ...s, draft: null }));
    },

    async drop(input: DropInput) {
      const draft = state.get().draft;
      if (!draft) return;
      const id = await shell.backend.rpc<string>("places", "drop_pin", {
        p_label: input.label.trim(),
        p_note: input.note.trim() || null,
        p_lat: draft.point.lat,
        p_lng: draft.point.lng,
        p_address: draft.address,
        p_crew_ids: input.crewIds,
      });
      state.set((s) => ({ ...s, draft: null }));
      await controller.refreshPins();
      if (state.get().pins.some((pin) => pin.id === id)) controller.selectPin(id);
    },

    canRemove(pin: Pin) {
      const id = userId();
      return !!id && canRemove(pin, id, shell.crewContext.store.get().crews);
    },

    async removePin(pinId: string) {
      await shell.backend.rpc("places", "remove_pin", { p_pin: pinId });
      seq++;
      state.set((s) => ({ ...s, pins: s.pins.filter((pin) => pin.id !== pinId), selection: s.selection?.kind === "pin" && s.selection.pinId === pinId ? null : s.selection }));
    },

    directions(place: Pick<Place, "lat" | "lng" | "name">) {
      return shell.handoff.openDirections({ lat: place.lat, lng: place.lng, label: place.name });
    },

    canMakeRdv: () => shell.hasRoute(RDV_CREATE_ROUTE),

    makeRdv(place: Place) {
      if (shell.hasRoute(RDV_CREATE_ROUTE)) shell.navigate(RDV_CREATE_ROUTE, { place });
    },

    pickPlace(): Promise<Place | null> {
      picking?.(null);
      return new Promise((resolve) => {
        picking = resolve;
        shell.navigate(PICKER_ROUTE);
      });
    },

    finishPick(place: Place | null) {
      const resolve = picking;
      picking = null;
      resolve?.(place);
    },

    placeOfPin,
  };
  return controller;
}

export type PlacesController = ReturnType<typeof createPlacesController>;
