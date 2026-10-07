import { createStore, type Store } from "@rdv/core/store";

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const RECENTS_KEY = "rdv.places.recent";
export const RECENTS_MAX = 8;

export interface Recents {
  store: Store<string[]>;
  load(): Promise<void>;
  add(query: string): void;
  clear(): void;
}

export function addRecent(list: string[], query: string, max = RECENTS_MAX): string[] {
  const clean = query.trim();
  if (!clean) return list;
  return [clean, ...list.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, max);
}

export function createRecents(kv: KV): Recents {
  const store = createStore<string[]>([]);
  const save = () => void kv.set(RECENTS_KEY, JSON.stringify(store.get())).catch(() => undefined);
  return {
    store,
    async load() {
      const raw = await kv.get(RECENTS_KEY).catch(() => null);
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) store.set(parsed.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX));
      } catch {
        store.set([]);
      }
    },
    add(query) {
      store.set((prev) => addRecent(prev, query));
      save();
    },
    clear() {
      store.set([]);
      save();
    },
  };
}
