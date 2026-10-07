import type { GeoPoint, MapPin, Shell } from "@rdv/core";
import { AppError, codeOf } from "@rdv/core/errors";
import { createStore, type Store } from "@rdv/core/store";
import { toArgs, type Draft } from "./draft";
import { formatTime } from "./format";
import { diffReminders, inCrews, rdvFromRow, remindersFor, shouldReportArrival, toMapPin, type Answer, type Rdv, type RdvRow, type Reminder } from "./model";

export interface Person {
  userId: string;
  handle: string;
  avatarPath: string | null;
  answer: Answer;
  arrived: boolean;
}

interface PersonRow {
  user_id: string;
  handle: string;
  avatar_path: string | null;
  answer: Answer;
  arrived: boolean;
}

export interface RdvsState {
  rdvs: Rdv[];
  loaded: boolean;
}

export interface ReminderStore {
  permitted(): Promise<boolean>;
  list(): Promise<{ key: string; at: number; title?: string; body?: string }[]>;
  schedule(reminder: Reminder): Promise<void>;
  cancel(key: string): Promise<void>;
}

export type ControllerShell = Pick<Shell, "backend" | "crewContext" | "session" | "locationStream" | "navigate" | "handoff">;

export const REFRESH_MS = 30000;
export const DETAIL_ROUTE = "RdvDetail";
export const EDIT_ROUTE = "RdvEdit";
export const PLANS_ROUTE = "Plans";
export const STATS_ROUTE = "Stats";
export const RETRY_AFTER_ERROR_MS = 60000;
export const MAX_LIVE_ATTEMPTS = 3;
const FINAL_CODES = new Set(["rdv_closed", "rdv_not_found"]);

export function createRdvsController(
  shell: ControllerShell,
  deps: { reminders: ReminderStore; readPosition: () => Promise<GeoPoint>; now?: () => number },
) {
  const now = deps.now ?? Date.now;
  const state = createStore<RdvsState>({ rdvs: [], loaded: false });
  const mapPins = createStore<MapPin[]>([]);
  const attempts = new Map<string, { n: number; at: number }>();
  const settled = new Set<string>();
  let limited = false;
  let lastSynced: string | null = null;
  let seq = 0;
  let syncing: Promise<void> = Promise.resolve();

  const userId = () => {
    const session = shell.session.get();
    return session.status === "signedIn" ? session.userId : null;
  };
  const selected = () => shell.crewContext.store.get().selected;

  const syncPins = () => {
    const { crews } = shell.crewContext.store.get();
    const t = now();
    mapPins.set(
      state.get().rdvs.flatMap((rdv) => toMapPin(rdv, crews, selected(), t, () => controller.open(rdv.id)) ?? []),
    );
  };

  const syncReminders = () => {
    const wanted = remindersFor(state.get().rdvs, now(), formatTime);
    const key = JSON.stringify(wanted);
    if (key === lastSynced) return syncing;
    syncing = syncing
      .then(async () => {
        if (key === lastSynced || !(await deps.reminders.permitted())) return;
        const { add, remove } = diffReminders(wanted, await deps.reminders.list());
        for (const stale of remove) await deps.reminders.cancel(stale);
        for (const reminder of add) await deps.reminders.schedule(reminder);
        lastSynced = key;
      })
      .catch(() => undefined);
    return syncing;
  };

  const check = () => {
    const id = userId();
    if (!id || limited) return;
    const position = shell.locationStream.store.get()[id];
    if (!position) return;
    const t = now();
    for (const rdv of state.get().rdvs) {
      if (settled.has(rdv.id)) continue;
      const tried = attempts.get(rdv.id);
      if (tried && (tried.n >= MAX_LIVE_ATTEMPTS || t - tried.at < RETRY_AFTER_ERROR_MS * 2 ** (tried.n - 1))) continue;
      if (shouldReportArrival(rdv, position, t)) void controller.report(rdv.id, position);
    }
  };

  state.subscribe(syncPins);
  shell.crewContext.store.subscribe(syncPins);
  shell.locationStream.store.subscribe(check);

  const controller = {
    state,
    pins: mapPins as Store<MapPin[]>,

    async refresh() {
      const mine = ++seq;
      const { crews, loaded } = shell.crewContext.store.get();
      const crewIds = crews.map((c) => c.id);
      if (userId() && crewIds.length === 0 && !loaded) return;
      if (!userId() || crewIds.length === 0) {
        state.set((s) => (s.rdvs.length || !s.loaded ? { rdvs: [], loaded: true } : s));
        return syncReminders();
      }
      try {
        const rows = await shell.backend.rpc<RdvRow[]>("rdvs", "list_rdvs", { p_crew_ids: crewIds });
        if (mine !== seq) return;
        state.set({ rdvs: rows.map(rdvFromRow), loaded: true });
        syncPins();
        void syncReminders();
        check();
      } catch {
        if (mine === seq) state.set((s) => (s.loaded ? s : { ...s, loaded: true }));
      }
    },

    start() {
      void controller.refresh();
      const timer = setInterval(() => {
        void controller.refresh();
        syncPins();
      }, REFRESH_MS);
      let crewIds = shell.crewContext.store.get().crews;
      const off = shell.crewContext.store.subscribe(() => {
        const next = shell.crewContext.store.get().crews;
        if (next === crewIds) return;
        crewIds = next;
        void controller.refresh();
      });
      return () => {
        clearInterval(timer);
        off();
        controller.reset();
      };
    },

    reset() {
      seq++;
      attempts.clear();
      settled.clear();
      limited = false;
      state.set({ rdvs: [], loaded: false });
      mapPins.set([]);
      void syncReminders();
    },

    forSelectedCrews(): Rdv[] {
      return state.get().rdvs.filter((rdv) => inCrews(rdv, selected()));
    },

    find: (id: string) => state.get().rdvs.find((rdv) => rdv.id === id) ?? null,

    open(id: string) {
      shell.navigate(DETAIL_ROUTE, { id });
    },

    async create(draft: Draft): Promise<string> {
      const id = await shell.backend.rpc<string>("rdvs", "create_rdv", toArgs(draft));
      await controller.refresh();
      return id;
    },

    async update(id: string, draft: Draft) {
      await shell.backend.rpc("rdvs", "update_rdv", { p_rdv: id, ...toArgs(draft) });
      await controller.refresh();
    },

    async cancel(id: string) {
      await shell.backend.rpc("rdvs", "cancel_rdv", { p_rdv: id });
      await controller.refresh();
    },

    async setRsvp(id: string, answer: Answer) {
      await shell.backend.rpc("rdvs", "set_rsvp", { p_rdv: id, p_answer: answer });
      await controller.refresh();
    },

    async people(id: string): Promise<Person[]> {
      const rows = await shell.backend.rpc<PersonRow[]>("rdvs", "list_rsvps", { p_rdv: id });
      return rows.map((row) => ({ userId: row.user_id, handle: row.handle, avatarPath: row.avatar_path, answer: row.answer, arrived: row.arrived }));
    },

    // A live member's arrival: the one reading that put them inside the radius is sent, and the server checks it.
    async report(id: string, position: GeoPoint) {
      attempts.set(id, { n: (attempts.get(id)?.n ?? 0) + 1, at: now() });
      try {
        await shell.backend.invoke("record_arrival", { rdv_id: id, position: { lat: position.lat, lng: position.lng }, method: "live" });
        settled.add(id);
        await controller.refresh();
      } catch (error) {
        const code = codeOf(error);
        if (FINAL_CODES.has(code)) settled.add(id);
        else if (code === "rate_limited") limited = true;
      }
    },

    // I'm here: one reading, checked by the server and then discarded. Throws outside_radius when it is not close enough.
    async markHere(id: string) {
      const position = await deps.readPosition();
      await shell.backend.invoke("record_arrival", { rdv_id: id, position: { lat: position.lat, lng: position.lng }, method: "here" });
      await controller.refresh();
    },

    meetsAttended: () => shell.backend.rpc<number>("rdvs", "my_meets_attended"),

    directions(rdv: Rdv) {
      if (!rdv.place) throw new AppError("rdv_place_invalid");
      return shell.handoff.openDirections({ lat: rdv.place.lat, lng: rdv.place.lng, label: rdv.place.name });
    },
  };
  return controller;
}

export type RdvsController = ReturnType<typeof createRdvsController>;
