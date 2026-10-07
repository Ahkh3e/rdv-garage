import type { MapPin, PinRegistry, PinSource } from "./contracts";
import { createStore } from "./store";

const SEP = ":";

export function createPinRegistry(): PinRegistry {
  const store = createStore<MapPin[]>([]);
  const sources = new Map<string, PinSource>();
  const offs = new Map<string, () => void>();

  const merge = () =>
    store.set(
      [...sources.values()].flatMap((source) =>
        source.pins.get().map((pin) => ({ ...pin, id: `${source.id}${SEP}${pin.id}` })),
      ),
    );

  return {
    store,
    register(source) {
      offs.get(source.id)?.();
      const off = source.pins.subscribe(merge);
      offs.set(source.id, off);
      sources.set(source.id, source);
      merge();
      return () => {
        if (sources.get(source.id) !== source) return;
        off();
        offs.delete(source.id);
        sources.delete(source.id);
        merge();
      };
    },
    press(id) {
      store.get().find((pin) => pin.id === id)?.onPress();
    },
  };
}
