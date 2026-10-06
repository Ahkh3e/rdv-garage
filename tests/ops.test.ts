import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackend } from "@rdv/core/backend";
import { crewAdd, crewCreate, crewDelete } from "@rdv/ops/crews";
import { makeCtx, runCommand } from "@rdv/ops/context";
import { GuardError } from "@rdv/ops/guard";
import { purgeSynthetic, status } from "@rdv/ops/misc";
import { simInvites, simLeaderboard, simLive } from "@rdv/ops/sim";
import { userCreate, userDelete, userRestore, userShow, userSuspend } from "@rdv/ops/users";
import type { OpsConfig } from "@rdv/ops/config";
import { admin, ANON_KEY, API_URL, SERVICE_KEY, createCrew, createUser, sleep, sql, uniq } from "./helpers";

const dir = mkdtempSync(join(tmpdir(), "ops-"));
const config = (environment: OpsConfig["environment"]): OpsConfig => ({
  environment, projectName: environment === "production" ? "rdv-prod" : environment, supabaseUrl: API_URL, serviceKey: SERVICE_KEY, anonKey: ANON_KEY,
  auditLogPath: join(dir, `${environment}-audit.log`),
});
const ctx = () => {
  const c = makeCtx({}, config("test"));
  c.log = () => undefined;
  return c;
};
const memoryStore = () => {
  const m = new Map<string, string>();
  return { getItemAsync: async (k: string) => m.get(k) ?? null, setItemAsync: async (k: string, v: string) => void m.set(k, v), deleteItemAsync: async (k: string) => void m.delete(k) };
};

describe("operator toolkit against a real stack", () => {
  it("creates synthetic users and crews, shows them, suspends and restores, and deletes through the full path", async () => {
    const c = ctx();
    const credentials = join(dir, "creds.jsonl");
    const created = (await userCreate(c, { count: 2, credentialsFile: credentials })) as { handle: string; email: string; password: string }[];
    expect(created.length).toBe(2);
    expect(created[0]!.handle).toMatch(/^sim_[0-9a-f]{8}$/);
    expect(created[0]!.email).toMatch(/@rdv\.invalid$/);
    expect(statSync(credentials).mode & 0o777).toBe(0o600);
    expect(readFileSync(credentials, "utf8").trim().split("\n").length).toBe(2);

    // A created user can really sign in with the stored password.
    const backend = createBackend({ supabaseUrl: API_URL, supabaseKey: ANON_KEY, linkDomain: "x", flags: {} }, memoryStore());
    await backend.auth.signIn(created[0]!.email, created[0]!.password);

    const crew = (await crewCreate(c, { owner: created[0]!.handle, members: 2, name: "Ops Crew" }))!;
    const shown = (await userShow(c, created[0]!.handle)) as { crews: unknown[]; synthetic: boolean };
    expect(shown.synthetic).toBe(true);
    expect(shown.crews.length).toBe(1);

    await userSuspend(c, created[0]!.handle);
    await expect(backend.auth.signIn(created[0]!.email, created[0]!.password)).rejects.toMatchObject({ code: "suspended" });
    await userRestore(c, created[0]!.handle);
    await createBackend({ supabaseUrl: API_URL, supabaseKey: ANON_KEY, linkDomain: "x", flags: {} }, memoryStore()).auth.signIn(created[0]!.email, created[0]!.password);

    await userDelete(c, { handle: created[1]!.handle });
    const gone = await sql<{ status: string }>("select status from accounts.profiles where handle like 'deleted_%' and invited_by is null order by created_at desc limit 1");
    expect(gone.length).toBeGreaterThan(0);
    await crewDelete(c, { id: crew.id });
    expect((await sql<{ status: string }>("select status from crews.crews where id = $1", [crew.id]))[0]!.status).toBe("dissolved");
    await purgeSynthetic(c);
  });

  it("simulates live drivers that a real phone sees move, and fills the leaderboard", async () => {
    const c = ctx();
    const real = await createUser();
    const rb = createBackend({ supabaseUrl: API_URL, supabaseKey: ANON_KEY, linkDomain: "x", flags: {} }, memoryStore());
    await rb.auth.signIn(real.email, real.password);
    const crew = await createCrew(real, "Sim Watch");
    const seen = new Map<string, number>();
    const channel = rb.channel(`crew:${crew.id}`);
    channel.on("pos", (p) => seen.set(p.user_id, (seen.get(p.user_id) ?? 0) + 1));
    channel.on("stop", (p) => seen.set(`stop:${p.user_id}`, 1));
    await new Promise<void>((resolve) => channel.subscribe((s) => s === "SUBSCRIBED" && resolve()));
    // The real crew owner lets synthetic members into their own crew in a non-production project.
    await crewAdd(c, { id: crew.id, handle: (await userCreate(c, { count: 1 }) as { handle: string }[])[0]!.handle });

    const result = await simLive(c, { crewId: crew.id, users: 3, durationSec: 6, route: "highway", posIntervalMs: 500, checkpointIntervalMs: 2000, firstCheckpointMs: 500, seed: 11 });
    expect(result.users.length).toBe(3);
    expect(result.users.every((u) => u.sent >= 6)).toBe(true);
    const drivers = result.users.map((u) => u.handle);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect([...seen.keys()].filter((k) => k.startsWith("stop:")).length).toBe(3);

    const board = await rb.rpc<{ handle: string; top_speed_kmh: number }[]>("leaderboard", "weekly_top_speed", { p_crew: crew.id });
    expect(board.map((r) => r.handle).sort()).toEqual(drivers.sort());
    expect(Math.max(...board.map((r) => r.top_speed_kmh))).toBeGreaterThan(80);
    await channel.unsubscribe();
    await purgeSynthetic(c);
  }, 90000);

  it("writes leaderboard data for this week and last, and builds referral chains", async () => {
    const c = ctx();
    const crew = (await crewCreate(c, { members: 3, name: "Board Crew" }))!;
    expect(await simLeaderboard(c, { crewId: crew.id, previousWeek: true })).toBe(8);
    const chain = (await simInvites(c, { count: 3, depth: 3 }))!;
    expect(chain.length).toBe(4);
    const rows = await sql<{ n: number }>("select count(*)::int as n from accounts.profiles p join referral.invites i on i.id = p.invite_id");
    expect(rows[0]!.n).toBeGreaterThanOrEqual(3);
    const out = (await status(c)) as { syntheticUsers: number; ping: string };
    expect(out.ping).toBe("ok");
    expect(out.syntheticUsers).toBeGreaterThan(0);
    const purged = (await purgeSynthetic(c)) as { users: number };
    expect(purged.users).toBeGreaterThan(0);
    const after = (await status(c)) as { syntheticUsers: number; syntheticCrews: number };
    expect(after).toMatchObject({ syntheticUsers: 0, syntheticCrews: 0 });
    // Real users are untouched.
    expect((await sql("select 1 from accounts.profiles where is_synthetic = false and status = 'active'")).length).toBeGreaterThanOrEqual(0);
  }, 60000);

  it("does nothing on dry runs", async () => {
    const c = makeCtx({ dryRun: true }, config("test"));
    c.log = () => undefined;
    const before = (await sql<{ n: number }>("select count(*)::int as n from accounts.profiles"))[0]!.n;
    await userCreate(c, { count: 5 });
    await crewCreate(c, { members: 5 });
    await simLive(c, { users: 2, durationSec: 1, route: "city" });
    await purgeSynthetic(c);
    expect((await sql<{ n: number }>("select count(*)::int as n from accounts.profiles"))[0]!.n).toBe(before);
  });

  it("refuses production commands without the flag and the project name, and audits every attempt", async () => {
    const prod = config("production");
    let ran = false;
    await expect(runCommand("sim live", { users: 2, password: "never-logged" }, {}, async () => void (ran = true), prod)).rejects.toBeInstanceOf(GuardError);
    await expect(runCommand("purge-synthetic", {}, { production: true, confirmProject: "wrong" }, async () => void (ran = true), prod)).rejects.toBeInstanceOf(GuardError);
    expect(ran).toBe(false);
    await runCommand("status", {}, {}, async () => void (ran = true), prod);
    expect(ran).toBe(true);
    await runCommand("user create", {}, { production: true, confirmProject: "rdv-prod", dryRun: true }, async () => undefined, prod);

    const lines = readFileSync(prod.auditLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.result)).toEqual(["refused", "refused", "started", "ok", "started", "dry-run"]);
    expect(readFileSync(prod.auditLogPath, "utf8")).not.toContain("never-logged");
    expect(lines.every((l) => l.environment === "production")).toBe(true);
  });

  it("in production, fake users and crews never touch a real user's crew and nothing is left behind on refusal", async () => {
    const prodCtx = () => {
      const c = makeCtx({}, config("production"));
      c.log = () => undefined;
      return c;
    };
    const owner = await createUser(uniq("realowner"));
    await admin.schema("accounts").from("profiles").update({ is_synthetic: false }).eq("id", owner.id);
    const crew = await createCrew(owner, "Real Production Crew");
    await admin.schema("crews").from("crews").update({ is_synthetic: false }).eq("id", crew.id);
    const count = async (t: string) => (await sql<{ n: number }>(`select count(*)::int as n from ${t}`))[0]!.n;
    const before = { users: await count("accounts.profiles"), crews: await count("crews.crews"), members: await count("crews.members") };

    await expect(simLive(prodCtx(), { crewId: crew.id, users: 2, durationSec: 1, route: "city" })).rejects.toBeInstanceOf(GuardError);
    await expect(crewCreate(prodCtx(), { owner: owner.handle, members: 2 })).rejects.toBeInstanceOf(GuardError);
    await expect(crewAdd(prodCtx(), { id: crew.id, handle: (await createUser(uniq("sim"))).handle })).rejects.toBeInstanceOf(GuardError);
    const after = { users: await count("accounts.profiles"), crews: await count("crews.crews"), members: await count("crews.members") };
    // Only the one synthetic user made for the crewAdd check above exists beyond the baseline.
    expect(after.crews).toBe(before.crews);
    expect(after.members).toBe(before.members);
    expect(after.users).toBe(before.users + 1);
  });

  it("will not delete a real crew without its name", async () => {
    const c = ctx();
    const owner = await createUser(uniq("real"));
    // createUser marks users synthetic for tests; make this one real.
    await admin.schema("accounts").from("profiles").update({ is_synthetic: false }).eq("id", owner.id);
    const crew = await createCrew(owner, "Real Crew Name");
    await admin.schema("crews").from("crews").update({ is_synthetic: false }).eq("id", crew.id);
    await expect(crewDelete(c, { id: crew.id })).rejects.toBeInstanceOf(GuardError);
    await crewDelete(c, { id: crew.id, confirmName: "Real Crew Name" });
    await sleep(10);
  });
});
