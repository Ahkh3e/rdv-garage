import type { GeoPoint, MapBridge, MapController, MapView, Poi } from "./contracts";
import { createStore } from "./store";

export function createMapBridge(): MapBridge {
  const view = createStore<MapView | null>(null);
  const me = createStore<GeoPoint | null>(null);
  const longPresses = new Set<(point: GeoPoint) => void>();
  const presses = new Set<() => void>();
  let controller: MapController | null = null;
  return {
    view,
    me,
    attach(next) {
      controller = next;
      return () => {
        if (controller === next) controller = null;
      };
    },
    setView: (next) => view.set(next),
    setMe: (point) => me.set(point),
    pois: () => controller?.queryPois() ?? Promise.resolve<Poi[]>([]),
    flyTo: (point, zoom) => controller?.flyTo(point, zoom),
    requestAtLeastHalf: () => controller?.openAtLeastHalf?.(),
    press() {
      for (const fn of [...presses]) fn();
    },
    onPress(fn) {
      presses.add(fn);
      return () => presses.delete(fn);
    },
    longPress(point) {
      for (const fn of [...longPresses]) fn(point);
    },
    onLongPress(fn) {
      longPresses.add(fn);
      return () => longPresses.delete(fn);
    },
  };
}
