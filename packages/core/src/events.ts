export type AppEvent =
  | { type: "session.started"; sessionId: string; crewIds: string[] }
  | { type: "session.ended"; sessionId: string }
  | { type: "crew.selected"; crewIds: string[] }
  | { type: "account.suspended" }
  | { type: "account.deleted" };

export type Unsubscribe = () => void;

export interface Events {
  emit<T extends AppEvent>(event: T): void;
  on<K extends AppEvent["type"]>(type: K, fn: (event: Extract<AppEvent, { type: K }>) => void): Unsubscribe;
}

export function createEvents(): Events {
  const handlers = new Map<string, Set<(event: AppEvent) => void>>();
  return {
    emit(event) {
      for (const fn of [...(handlers.get(event.type) ?? [])]) {
        try {
          fn(event);
        } catch (error) {
          console.error(`handler for ${event.type} failed`, error);
        }
      }
    },
    on(type, fn) {
      const set = handlers.get(type) ?? new Set();
      set.add(fn as (event: AppEvent) => void);
      handlers.set(type, set);
      return () => set.delete(fn as (event: AppEvent) => void);
    },
  };
}
