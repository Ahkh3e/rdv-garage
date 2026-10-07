import type { GeoPoint, Geocoder, Place } from "@rdv/core";
import { codeOf } from "@rdv/core/errors";
import { createStore, type Store } from "@rdv/core/store";
import { coarseBias } from "./bias";
import { debounce } from "./debounce";
import { queryReady } from "./validation";

export const DEBOUNCE_MS = 350;

export interface SearchState {
  query: string;
  status: "idle" | "loading" | "done" | "error";
  results: Place[];
  error: string | null;
}

export interface Search {
  state: Store<SearchState>;
  setQuery(text: string): void;
  reset(): void;
}

const IDLE: SearchState = { query: "", status: "idle", results: [], error: null };

export function createSearch(geocoder: Geocoder, bias: () => GeoPoint | null, ms = DEBOUNCE_MS): Search {
  const state = createStore<SearchState>(IDLE);
  let sequence = 0;

  const run = debounce(async (text: string) => {
    const mine = ++sequence;
    state.set((prev) => ({ ...prev, status: "loading", error: null }));
    try {
      const results = await geocoder.search(text.trim(), coarseBias(bias()));
      if (mine === sequence) state.set({ query: text, status: "done", results, error: null });
    } catch (error) {
      if (mine === sequence) state.set({ query: text, status: "error", results: [], error: codeOf(error) });
    }
  }, ms);

  return {
    state,
    setQuery(text) {
      run.cancel();
      sequence++;
      if (!queryReady(text)) return state.set({ ...IDLE, query: text });
      state.set((prev) => ({ ...prev, query: text, status: "loading", error: null }));
      run(text);
    },
    reset() {
      run.cancel();
      sequence++;
      state.set(IDLE);
    },
  };
}
