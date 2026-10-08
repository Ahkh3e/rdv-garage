import { describe, expect, it } from "vitest";
import { createTalkTimer, TALK_LIMIT_MS } from "./talkTimer";

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
