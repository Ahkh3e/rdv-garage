import type { Backend, ChannelLike } from "@rdv/core";

type Listener = (event: "pos" | "stop", payload: any) => void;

interface Entry {
  channel: ChannelLike;
  refs: number;
  ready: boolean;
  trackState: Record<string, unknown> | null;
  listeners: Set<Listener>;
}

// One realtime channel per crew, shared by the sender and the receiver and reference counted.
export class ChannelHub {
  private entries = new Map<string, Entry>();

  constructor(private readonly backend: Backend) {}

  acquire(crewId: string): () => void {
    let entry = this.entries.get(crewId);
    if (!entry) {
      const channel = this.backend.channel(`crew:${crewId}`);
      const created: Entry = { channel, refs: 0, ready: false, trackState: null, listeners: new Set() };
      channel.on("pos", (payload) => created.listeners.forEach((fn) => fn("pos", payload)));
      channel.on("stop", (payload) => created.listeners.forEach((fn) => fn("stop", payload)));
      channel.subscribe((status) => {
        created.ready = status === "SUBSCRIBED";
        // Presence asked for before the channel was ready is announced as soon as it is, and again after a reconnect.
        if (created.ready && created.trackState) channel.track(created.trackState).catch(() => undefined);
      });
      this.entries.set(crewId, created);
      entry = created;
    }
    entry.refs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.entries.get(crewId);
      if (!current) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        this.entries.delete(crewId);
        current.channel.unsubscribe().catch(() => undefined);
      }
    };
  }

  listen(crewId: string, fn: Listener): () => void {
    const entry = this.entries.get(crewId);
    entry?.listeners.add(fn);
    return () => entry?.listeners.delete(fn);
  }

  send(crewId: string, event: "pos" | "stop", payload: Record<string, unknown>): void {
    const entry = this.entries.get(crewId);
    if (!entry?.ready) return;
    entry.channel.send(event, payload).catch(() => undefined);
  }

  track(crewId: string, state: Record<string, unknown>): void {
    const entry = this.entries.get(crewId);
    if (!entry) return;
    entry.trackState = state;
    if (entry.ready) entry.channel.track(state).catch(() => undefined);
  }

  untrack(crewId: string): void {
    const entry = this.entries.get(crewId);
    if (!entry) return;
    entry.trackState = null;
    entry.channel.untrack().catch(() => undefined);
  }

  isReady(crewId: string): boolean {
    return this.entries.get(crewId)?.ready ?? false;
  }
}
