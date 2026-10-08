import { describe, expect, it } from "vitest";
import { emptyPeople, PRESENT_TTL_MS, reducePeople, SPEAKER_TTL_MS } from "./people";
import { createTalkTimer, TALK_LIMIT_MS } from "./talkTimer";

describe("people reducer", () => {
  it("tracks several talkers at once and removes each on its own stop", () => {
    let s = reducePeople(emptyPeople, { type: "start", userId: "a", identity: "ia", at: 1 });
    s = reducePeople(s, { type: "start", userId: "b", identity: "ib", at: 2 });
    expect(Object.keys(s.speakers).sort()).toEqual(["a", "b"]);
    s = reducePeople(s, { type: "stop", userId: "a", at: 3 });
    expect(Object.keys(s.speakers)).toEqual(["b"]);
    expect(Object.keys(s.present).sort()).toEqual(["a", "b"]);
  });

  it("ignores a stop for someone not talking and keeps identity on presence refreshes", () => {
    const same = reducePeople(emptyPeople, { type: "stop", userId: "a", at: 1 });
    expect(same).toBe(emptyPeople);
    let s = reducePeople(emptyPeople, { type: "join", userId: "a", identity: "ia", at: 1 });
    s = reducePeople(s, { type: "here", userId: "a", at: 5 });
    expect(s.present.a).toEqual({ identity: "ia", at: 5 });
  });

  it("drops a talker whose stop never arrived and a member who stopped sending heartbeats", () => {
    let s = reducePeople(emptyPeople, { type: "start", userId: "a", identity: "ia", at: 0 });
    s = reducePeople(s, { type: "here", userId: "b", at: 0 });
    s = reducePeople(s, { type: "expire", at: SPEAKER_TTL_MS + 1 });
    expect(s.speakers).toEqual({});
    expect(Object.keys(s.present).sort()).toEqual(["a", "b"]);
    expect(reducePeople(s, { type: "expire", at: PRESENT_TTL_MS + 1 }).present).toEqual({});
    const stable = reducePeople(emptyPeople, { type: "expire", at: 99 });
    expect(stable).toBe(emptyPeople);
  });

  it("removes a person who leaves from both lists", () => {
    let s = reducePeople(emptyPeople, { type: "start", userId: "a", at: 0 });
    s = reducePeople(s, { type: "leave", userId: "a", at: 1 });
    expect(s).toEqual(emptyPeople);
    expect(reducePeople(s, { type: "reset" })).toBe(emptyPeople);
  });
});

describe("talk timer", () => {
  const fake = () => {
    const jobs = new Map<number, { fn: () => void; at: number }>();
    let id = 0;
    let clock = 0;
    return {
      timers: { set: (fn: () => void, ms: number) => (jobs.set(++id, { fn, at: clock + ms }), id), clear: (h: unknown) => void jobs.delete(h as number) },
      advance(ms: number) {
        clock += ms;
        for (const [k, j] of [...jobs]) if (j.at <= clock) { jobs.delete(k); j.fn(); }
      },
    };
  };

  it("closes after sixty seconds and not before", () => {
    const f = fake();
    let expired = 0;
    const t = createTalkTimer(() => expired++, undefined, f.timers);
    t.start();
    expect(t.active()).toBe(true);
    f.advance(TALK_LIMIT_MS - 1);
    expect(expired).toBe(0);
    f.advance(1);
    expect(expired).toBe(1);
    expect(t.active()).toBe(false);
  });

  it("does not fire after a release, and restarts cleanly", () => {
    const f = fake();
    let expired = 0;
    const t = createTalkTimer(() => expired++, 1000, f.timers);
    t.start();
    f.advance(500);
    t.stop();
    f.advance(5000);
    expect(expired).toBe(0);
    t.start();
    f.advance(500);
    t.start();
    f.advance(900);
    expect(expired).toBe(0);
    f.advance(100);
    expect(expired).toBe(1);
  });
});
