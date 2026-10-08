import { describe, expect, it } from "vitest";
import pg from "pg";
import { admin, call, callOk, createCrew, createUser, DB_URL, invokeAs, register, signIn, sql, uniq } from "./helpers";

describe("review hardening", () => {
  it("rejects NaN and Infinity checkpoints so one bad value cannot hold first place", async () => {
    const u = await createUser();
    const crew = await createCrew(u);
    const sid = await callOk<string>(u.client, "live", "start_session", { p_crew_ids: [crew.id] });
    // PostgREST accepts these as numbers in text form.
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: "NaN", p_distance_m: 1 })).error).toBe("invalid_checkpoint");
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: "Infinity", p_distance_m: 1 })).error).toBe("invalid_checkpoint");
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 100, p_distance_m: "-Infinity" })).error).toBe("invalid_checkpoint");
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 100, p_distance_m: 5 })).error).toBeNull();
    const board = await callOk<{ top_speed_kmh: number }[]>(u.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id });
    expect(board[0]!.top_speed_kmh).toBe(100);
  });

  it("writes the previous week's final values to the previous week only, and refuses any other week", async () => {
    const u = await createUser();
    const crew = await createCrew(u);
    const sid = await callOk<string>(u.client, "live", "start_session", { p_crew_ids: [crew.id] });
    const thisWeek = await callOk<string>(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 90, p_distance_m: 10 });
    const day = (offset: number) => new Date(Date.parse(thisWeek + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
    const prev = day(-7);
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 200, p_distance_m: 500, p_week_start: prev })).error).toBeNull();
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 200, p_distance_m: 500, p_week_start: day(-14) })).error).toBe("invalid_checkpoint");
    expect((await call(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 200, p_distance_m: 500, p_week_start: day(7) })).error).toBe("invalid_checkpoint");
    const now = await callOk<{ top_speed_kmh: number }[]>(u.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id });
    const before = await callOk<{ top_speed_kmh: number }[]>(u.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id, p_week_start: prev });
    expect(now[0]!.top_speed_kmh).toBe(90);
    expect(before[0]!.top_speed_kmh).toBe(200);
  });

  it("garbage requests cannot lock a person's email out of registering", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const victim = `${uniq("victim")}@example.test`;
    for (let i = 0; i < 8; i++) {
      const bad = await register({ invite_code: "ZZZZZZZZZZZZ", handle: uniq("g"), email: victim, password: "longenough1", terms_version: "v2", age_confirmed: true });
      expect(bad.body.error).toBe("invalid_invite");
    }
    const ok = await register({ invite_code: invite!.code, handle: uniq("v"), email: victim, password: "longenough1", terms_version: "v2", age_confirmed: true });
    expect(ok.body.status).toBe("confirmed");
  });

  it("per-email limit still stops repeated valid attempts", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const email = `${uniq("rep")}@example.test`;
    const results: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await register({ invite_code: invite!.code, handle: uniq("r"), email, password: "longenough1", terms_version: "v2", age_confirmed: true });
      results.push(r.body.error ?? r.body.status);
    }
    expect(results.slice(0, 5)).not.toContain("rate_limited");
    expect(results.slice(5)).toEqual(["rate_limited", "rate_limited"]);
  });

  it("reads the terms version from settings instead of a hardcoded value", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    await sql("update private.settings set value = 'v3' where key = 'terms_version'");
    try {
      const body = (h: string, v: string) => ({ invite_code: invite!.code, handle: h, email: `${h}@example.test`, password: "longenough1", terms_version: v, age_confirmed: true });
      expect((await register(body(uniq("t"), "v2"))).body.error).toBe("terms_required");
      expect((await register(body(uniq("t"), "v3"))).body.status).toBe("confirmed");
    } finally {
      await sql("update private.settings set value = 'v2' where key = 'terms_version'");
    }
  });

  it("a wrong current password does not sign any device out", async () => {
    const u = await createUser();
    const other = await signIn(u.email, u.password);
    const before = await callOk<unknown[]>(u.client, "accounts", "list_sessions");
    expect((await invokeAs(u.client, "change-password", { current: "not-the-password", next: "another-long-one" })).body.error).toBe("wrong_password");
    const after = await callOk<unknown[]>(u.client, "accounts", "list_sessions");
    expect(after.length).toBe(before.length);
    expect((await call(other, "accounts", "my_profile")).error).toBeNull();
  });

  it("the cleanup sweep keeps going when one row cannot be removed", async () => {
    // A: unconfirmed, with an invite that references its profile, so deleting the profile fails.
    const a = await admin.auth.admin.createUser({ email: `${uniq("a")}@example.test`, password: "longenough1", email_confirm: false });
    await admin.schema("accounts").rpc("create_profile", { p_id: a.data.user!.id, p_handle: uniq("sa"), p_invited_by: null, p_invite_id: null, p_terms_version: "v1", p_synthetic: true });
    await sql("insert into referral.invites (inviter_id, code, expires_at) values ($1, $2, now() + interval '1 day')", [a.data.user!.id, uniq("CODE").toUpperCase().padEnd(12, "X").slice(0, 12)]);
    await sql("update auth.users set created_at = now() - interval '30 hours' where id = $1", [a.data.user!.id]);
    // B: plain unconfirmed, should still be removed.
    const b = await admin.auth.admin.createUser({ email: `${uniq("b")}@example.test`, password: "longenough1", email_confirm: false });
    await admin.schema("accounts").rpc("create_profile", { p_id: b.data.user!.id, p_handle: uniq("sb"), p_invited_by: null, p_invite_id: null, p_terms_version: "v1", p_synthetic: true });
    await sql("update auth.users set created_at = now() - interval '30 hours' where id = $1", [b.data.user!.id]);

    await callOk<number>(admin, "accounts", "cleanup_unconfirmed");
    expect((await admin.auth.admin.getUserById(b.data.user!.id)).data.user).toBeNull();
    // A stays intact: its profile survived, so its auth user was not removed.
    expect((await sql("select 1 from accounts.profiles where id = $1", [a.data.user!.id])).length).toBe(1);
    expect((await admin.auth.admin.getUserById(a.data.user!.id)).data.user).not.toBeNull();
  });

  it("delete-account removes every avatar file, not just the first page", async () => {
    const u = await createUser();
    const bytes = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 120; i++) {
      const { error } = await admin.storage.from("avatars").upload(`${u.id}/f${String(i).padStart(3, "0")}.jpg`, bytes, { contentType: "image/jpeg" });
      expect(error).toBeNull();
    }
    expect((await invokeAs(u.client, "delete-account")).body.ok).toBe(true);
    const left = await admin.storage.from("avatars").list(u.id, { limit: 200 });
    expect(left.data?.length ?? 0).toBe(0);
  }, 120000);

  it("client ip prefers the platform header and ignores a forged front of x-forwarded-for", async () => {
    const client = new pg.Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const ip = async (headers: Record<string, string>) => {
        await client.query("select set_config('request.headers', $1, false)", [JSON.stringify(headers)]);
        return (await client.query("select private.client_ip() as ip")).rows[0].ip as string;
      };
      expect(await ip({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 10.0.0.2" })).toBe("203.0.113.9");
      expect(await ip({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" })).toBe("198.51.100.4");
      expect(await ip({ "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4");
      expect(await ip({})).toBe("unknown");
    } finally {
      await client.end();
    }
  });
});
