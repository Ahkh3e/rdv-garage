import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

async function week(ts: string): Promise<string> {
  const [row] = await sql<{ w: string }>("select to_char(private.week_start_of($1::timestamptz), 'YYYY-MM-DD') as w", [ts]);
  return row!.w;
}

describe("Toronto-time week boundary", () => {
  it("rolls over at Monday 00:00 Toronto time (EDT)", async () => {
    expect(await week("2025-10-06T03:59:59Z")).toBe("2025-09-29");
    expect(await week("2025-10-06T04:00:00Z")).toBe("2025-10-06");
    expect(await week("2025-10-12T23:59:59-04:00")).toBe("2025-10-06");
  });
  it("handles the autumn clock change (EST) and the spring one", async () => {
    expect(await week("2025-11-03T04:59:59Z")).toBe("2025-10-27");
    expect(await week("2025-11-03T05:00:00Z")).toBe("2025-11-03");
    expect(await week("2025-03-10T03:59:59Z")).toBe("2025-03-03");
    expect(await week("2025-03-10T04:00:00Z")).toBe("2025-03-10");
  });
});

describe("codes", () => {
  it("generates codes of the right length from the safe alphabet", async () => {
    const [row] = await sql<{ c: string }>("select private.gen_code(12) as c");
    expect(row!.c).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
});

describe("rate limiting", () => {
  it("raises rate_limited when the window is full and recovers in a new window", async () => {
    const key = `test:${Date.now()}`;
    await sql("select private.hit_rate_limit($1, 2, 3600)", [key]);
    await sql("select private.hit_rate_limit($1, 2, 3600)", [key]);
    await expect(sql("select private.hit_rate_limit($1, 2, 3600)", [key])).rejects.toThrow(/rate_limited/);
    await sql("update private.rate_limits set window_start = now() - interval '2 hours' where key = $1", [key]);
    await sql("select private.hit_rate_limit($1, 2, 3600)", [key]);
  });
});
