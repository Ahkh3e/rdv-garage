import type { MapPin, PinRegistry, PinSource } from "./contracts";
import { createStore } from "./store";

const SEP = ":";

export function createPinRegistry(): PinRegistry {
  const store = createStore<MapPin[]>([]);
  const sources = new Map<string, PinSource>();

  const merge = () =>
    store.set(
      [...sources.values()].flatMap((source) =>
        source.pins.get().map((pin) => ({ ...pin, id: `${source.id}${SEP}${pin.id}` })),
      ),
    );

  return {
    store,
    register(source) {
      const off = source.pins.subscribe(merge);
      sources.set(source.id, source);
      merge();
      return () => {
        off();
        if (sources.get(source.id) === source) sources.delete(source.id);
        merge();
      };
    },
    press(id) {
      store.get().find((pin) => pin.id === id)?.onPress();
    },
  };
}
