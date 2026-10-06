import { describe, expect, it } from "vitest";
import { createStore } from "@rdv/core/store";
import { startReceiver } from "./receiver";

function setup(crews: { id: string; members: { userId: string }[] }[]) {
  const listeners = new Map<string, (event: "pos" | "stop", payload: any) => void>();
  const hub: any = {
    acquire: () => () => undefined,
    listen: (crewId: string, fn: (event: "pos" | "stop", payload: any) => void) => {
      listeners.set(crewId, fn);
      return () => listeners.delete(crewId);
    },
  };
  const positions = createStore<Record<string, any>>({});
  const asked: unknown[] = [];
  const shell: any = {
    events: { emit: (e: unknown) => void asked.push(e) },
    backend: { userId: () => "me" },
    session: { get: () => ({ status: "signedIn" }), subscribe: () => () => undefined },
    live: { subscribe: () => () => undefined },
    crewContext: { store: { get: () => ({ selected: crews.map((c) => c.id), crews }), subscribe: () => () => undefined } },
    locationStream: {
      publish: (p: any) => positions.set((s) => ({ ...s, [p.userId]: p })),
      remove: (id: string) => positions.set(({ [id]: _x, ...rest }) => rest),
      clear: () => positions.set({}),
    },
  };
  const stop = startReceiver(shell, hub, () => []);
  return { listeners, positions, stop, asked };
}

describe("receiver", () => {
  it("shows members of the crew and merges the crews they share", () => {
    const { listeners, positions, stop } = setup([
      { id: "a", members: [{ userId: "u1" }] },
      { id: "b", members: [{ userId: "u1" }] },
    ]);
    listeners.get("a")!("pos", { user_id: "u1", lat: 1, lng: 2, heading: 90, ts: Date.now() });
    listeners.get("b")!("pos", { user_id: "u1", lat: 1, lng: 2, heading: 90, ts: Date.now() });
    expect(positions.get().u1.crewIds.sort()).toEqual(["a", "b"]);
    listeners.get("a")!("stop", { user_id: "u1" });
    expect(positions.get().u1.crewIds).toEqual(["b"]);
    listeners.get("b")!("stop", { user_id: "u1" });
    expect(positions.get().u1).toBeUndefined();
    stop();
  });

  it("ignores a position for someone who is not in the crew it arrived on, and ignores yourself", () => {
    const { listeners, positions, stop } = setup([{ id: "a", members: [{ userId: "u1" }, { userId: "me" }] }]);
    listeners.get("a")!("pos", { user_id: "stranger", lat: 1, lng: 2, ts: Date.now() });
    listeners.get("a")!("pos", { user_id: "me", lat: 1, lng: 2, ts: Date.now() });
    expect(Object.keys(positions.get())).toEqual([]);
    listeners.get("a")!("stop", { user_id: "stranger" });
    stop();
  });

  it("stamps positions with the time they arrived, not the sender's clock", () => {
    const { listeners, positions, stop } = setup([{ id: "a", members: [{ userId: "u1" }] }]);
    const before = Date.now();
    listeners.get("a")!("pos", { user_id: "u1", lat: 1, lng: 2, ts: 5 });
    expect(positions.get().u1.ts).toBeGreaterThanOrEqual(before);
    stop();
  });

  it("asks for a fresh crew list when someone unknown shows up, at most every ten seconds", () => {
    const { listeners, asked, stop } = setup([{ id: "a", members: [{ userId: "u1" }] }]);
    listeners.get("a")!("pos", { user_id: "newjoiner", lat: 1, lng: 2, ts: Date.now() });
    listeners.get("a")!("pos", { user_id: "newjoiner", lat: 1, lng: 2, ts: Date.now() });
    expect(asked).toEqual([{ type: "crews.refresh" }]);
    stop();
  });

  it("ignores malformed positions", () => {
    const { listeners, positions, stop } = setup([{ id: "a", members: [{ userId: "u1" }] }]);
    listeners.get("a")!("pos", { user_id: "u1", lat: "x", lng: 2 });
    listeners.get("a")!("pos", {});
    expect(Object.keys(positions.get())).toEqual([]);
    stop();
  });
});
