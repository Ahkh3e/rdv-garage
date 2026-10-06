import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redact, writeAudit } from "./audit";
import type { OpsConfig } from "./config";
import { GuardError, assertCrewAddAllowed, assertInviterAllowed, guard } from "./guard";
import { ROUTES, Walker, mulberry32 } from "./routes";

const base: OpsConfig = { environment: "production", projectName: "rdv-prod", supabaseUrl: "http://x", serviceKey: "k", anonKey: "a", auditLogPath: "/dev/null" };
const dev: OpsConfig = { ...base, environment: "development", projectName: "development" };

describe("audit", () => {
  it("redacts secrets, including nested ones", () => {
    expect(redact({ handle: "a", password: "p", nested: { service_key: "k", token: "t", ok: 1 }, list: [{ secret: "s" }] })).toEqual({
      handle: "a", password: "[redacted]", nested: { service_key: "[redacted]", token: "[redacted]", ok: 1 }, list: [{ secret: "[redacted]" }],
    });
  });
  it("appends one JSON line per command with no secrets", () => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "audit.log");
    writeAudit(path, { environment: "test", command: "user create", args: { count: 2, password: "hunter2" }, result: "ok" });
    writeAudit(path, { environment: "test", command: "status", args: {}, result: "ok" });
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ command: "user create", environment: "test", result: "ok", args: { count: 2, password: "[redacted]" } });
    expect(readFileSync(path, "utf8")).not.toContain("hunter2");
    expect(typeof lines[0].ts).toBe("string");
    expect(typeof lines[0].operator).toBe("string");
  });
});

describe("production guard", () => {
  const never = async () => {
    throw new Error("should not ask");
  };
  it("lets everything run outside production", async () => {
    await expect(guard(dev, "purge-synthetic", {}, never)).resolves.toBeUndefined();
  });
  it("lets read-only commands run in production", async () => {
    for (const c of ["user show", "invite list", "status"]) await expect(guard(base, c, {}, never)).resolves.toBeUndefined();
  });
  it("refuses every other command in production without the flag", async () => {
    for (const c of ["user create", "user delete", "user suspend", "crew create", "crew delete", "crew add", "sim live", "sim leaderboard", "sim invites", "purge-synthetic"]) {
      await expect(guard(base, c, {}, never)).rejects.toBeInstanceOf(GuardError);
    }
  });
  it("needs the typed project name as well as the flag", async () => {
    await expect(guard(base, "sim live", { production: true }, async () => "nope")).rejects.toBeInstanceOf(GuardError);
    await expect(guard(base, "sim live", { production: true }, async () => "rdv-prod")).resolves.toBeUndefined();
    await expect(guard(base, "sim live", { production: true, confirmProject: "rdv-prod" }, never)).resolves.toBeUndefined();
    await expect(guard(base, "sim live", { production: true, confirmProject: "other" }, never)).rejects.toBeInstanceOf(GuardError);
  });
  it("limits who synthetic users can hang under in production only", () => {
    expect(() => assertInviterAllowed(base, false)).toThrow(GuardError);
    expect(() => assertInviterAllowed(base, true)).not.toThrow();
    expect(() => assertInviterAllowed(dev, false)).not.toThrow();
    expect(() => assertCrewAddAllowed(base, false, true)).toThrow(GuardError);
    expect(() => assertCrewAddAllowed(base, true, true)).not.toThrow();
    expect(() => assertCrewAddAllowed(dev, false, true)).not.toThrow();
  });
});

describe("routes", () => {
  it("is deterministic for a seed and stays near Toronto", () => {
    const run = () => {
      const w = new Walker(ROUTES.city, "city", 42);
      return Array.from({ length: 200 }, () => w.step(3));
    };
    expect(run()).toEqual(run());
    for (const s of run()) {
      expect(s.lat).toBeGreaterThan(43.6);
      expect(s.lat).toBeLessThan(43.8);
      expect(s.lng).toBeGreaterThan(-79.5);
      expect(s.lng).toBeLessThan(-79.2);
      expect(s.speedKmh).toBeGreaterThanOrEqual(0);
    }
  });
  it("drives faster on the highway than in the city", () => {
    const max = (style: "city" | "highway") => {
      const w = new Walker(ROUTES[style], style, 7);
      return Math.max(...Array.from({ length: 300 }, () => w.step(3).speedKmh));
    };
    expect(max("highway")).toBeGreaterThan(max("city"));
  });
  it("mulberry32 is in range", () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) expect(r()).toBeGreaterThanOrEqual(0);
  });
});

import { assertSyntheticCrewOwner } from "./guard";

describe("synthetic crew owner guard", () => {
  it("allows only synthetic owners in production", () => {
    expect(() => assertSyntheticCrewOwner(base, false)).toThrow(GuardError);
    expect(() => assertSyntheticCrewOwner(base, true)).not.toThrow();
    expect(() => assertSyntheticCrewOwner(dev, false)).not.toThrow();
  });
});
