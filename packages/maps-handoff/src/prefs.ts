import { createStore, type Store } from "@rdv/core/store";
import { DEFAULT_APP, isMapsApp, type MapsApp } from "./apps";

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const PREF_KEY = "rdv.maps.app";

export interface MapsPrefs {
  store: Store<MapsApp | null>;
  readonly ready: Promise<void>;
  load(): Promise<void>;
  set(app: MapsApp): void;
}

export function createMapsPrefs(kv: KV): MapsPrefs {
  const store = createStore<MapsApp | null>(null);
  let ready: Promise<void> = Promise.resolve();
  return {
    store,
    get ready() {
      return ready;
    },
    load() {
      ready = (async () => {
        const raw = await kv.get(PREF_KEY).catch(() => null);
        if (isMapsApp(raw)) store.set(raw);
      })();
      return ready;
    },
    set(app) {
      store.set(app);
      void kv.set(PREF_KEY, app).catch(() => undefined);
    },
  };
}

export const effectiveApp = (preferred: MapsApp | null): MapsApp => preferred ?? DEFAULT_APP;
