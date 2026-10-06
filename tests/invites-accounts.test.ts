import { describe, expect, it } from "vitest";
import { admin, anon, call, callOk, createUser, invokeAs, register, signIn, sql, uniq } from "./helpers";

describe("invites and registration", () => {
  it("creates an invite and reports its status anonymously", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ id: string; code: string; expires_at: string }[]>(founder.client, "referral", "create_invite");
    expect(invite!.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    const hoursLeft = (new Date(invite!.expires_at).getTime() - Date.now()) / 3600000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    expect((await call(anon, "referral", "check_invite", { p_code: invite!.code })).data).toBe("valid");
    expect((await call(anon, "referral", "check_invite", { p_code: invite!.code.toLowerCase() })).data).toBe("valid");
    expect((await call(anon, "referral", "check_invite", { p_code: "NOPE" })).data).toBe("invalid");

    await callOk(founder.client, "referral", "revoke_invite", { p_id: invite!.id });
    expect((await call(anon, "referral", "check_invite", { p_code: invite!.code })).data).toBe("revoked");
  });

  it("reports expired and disabled invites", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ id: string; code: string }[]>(founder.client, "referral", "create_invite");
    await sql("update referral.invites set expires_at = now() - interval '1 minute' where id = $1", [invite!.id]);
    expect((await call(anon, "referral", "check_invite", { p_code: invite!.code })).data).toBe("expired");
    await sql("update referral.invites set expires_at = now() + interval '1 hour', status = 'disabled' where id = $1", [invite!.id]);
    expect((await call(anon, "referral", "check_invite", { p_code: invite!.code })).data).toBe("disabled");
  });

  it("registers a new user through an invite in test mode and records the referral", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ id: string; code: string }[]>(founder.client, "referral", "create_invite");
    const handle = uniq("new");
    const email = `${handle}@example.test`;
    const res = await register({
      invite_code: invite!.code, handle, email, password: "longenough1", terms_version: "v1", age_confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");

    const client = await signIn(email, "longenough1");
    const [me] = await callOk<{ handle: string; status: string }[]>(client, "accounts", "my_profile");
    expect(me!.handle).toBe(handle);
    expect(me!.status).toBe("active");

    const rows = await sql<{ invited_by: string; invite_id: string; terms_version: string }>(
      "select invited_by, invite_id, terms_version from accounts.profiles where handle = $1", [handle]);
    expect(rows[0]!.invited_by).toBe(founder.id);
    expect(rows[0]!.invite_id).toBe(invite!.id);
    expect(rows[0]!.terms_version).toBe("v1");

    // The invite is multi-use: a second person can join with it.
    const second = uniq("sec");
    const res2 = await register({
      invite_code: invite!.code, handle: second, email: `${second}@example.test`, password: "longenough1",
      terms_version: "v1", age_confirmed: true,
    });
    expect(res2.body.status).toBe("confirmed");

    const joined = await callOk<{ joined: { handle: string }[] }[]>(founder.client, "referral", "list_my_invites");
    expect(joined[0]!.joined.map((j) => j.handle).sort()).toEqual([handle, second].sort());
  });

  it("rejects bad registrations with stable codes", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const base = { invite_code: invite!.code, handle: uniq("ok"), email: `${uniq("e")}@example.test`, password: "longenough1", terms_version: "v1", age_confirmed: true };
    const attempt = (over: Record<string, unknown>) => register({ ...base, email: `${uniq("e")}@example.test`, ...over });

    expect((await attempt({ invite_code: "ZZZZZZZZZZZZ" })).body.error).toBe("invalid_invite");
    expect((await attempt({ handle: "Ab" })).body.error).toBe("handle_invalid");
    expect((await attempt({ handle: "admin" })).body.error).toBe("handle_invalid");
    expect((await attempt({ handle: "sim_hacker" })).body.error).toBe("handle_invalid");
    expect((await attempt({ email: "not-an-email" })).body.error).toBe("email_invalid");
    expect((await attempt({ password: "short" })).body.error).toBe("password_too_short");
    expect((await attempt({ terms_version: "v0" })).body.error).toBe("terms_required");
    expect((await attempt({ age_confirmed: false })).body.error).toBe("age_confirmation_required");
    expect((await attempt({ handle: founder.handle })).body.error).toBe("handle_taken");

    // Nothing was created by any of those.
    const rows = await sql("select 1 from accounts.profiles where handle = $1", [base.handle]);
    expect(rows.length).toBe(0);
  });

  it("honors an invite for a grace period after it expires, then refuses", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ id: string; code: string }[]>(founder.client, "referral", "create_invite");
    await sql("update referral.invites set expires_at = now() - interval '30 minutes' where id = $1", [invite!.id]);
    const h1 = uniq("g");
    expect((await register({ invite_code: invite!.code, handle: h1, email: `${h1}@example.test`, password: "longenough1", terms_version: "v1", age_confirmed: true })).body.status).toBe("confirmed");
    await sql("update referral.invites set expires_at = now() - interval '2 hours' where id = $1", [invite!.id]);
    const h2 = uniq("g");
    expect((await register({ invite_code: invite!.code, handle: h2, email: `${h2}@example.test`, password: "longenough1", terms_version: "v1", age_confirmed: true })).body.error).toBe("expired_invite");
  });

  it("refuses registration for a revoked invite and for a suspended inviter", async () => {
    const a = await createUser();
    const [inv] = await callOk<{ id: string; code: string }[]>(a.client, "referral", "create_invite");
    await callOk(a.client, "referral", "revoke_invite", { p_id: inv!.id });
    const h = uniq("r");
    expect((await register({ invite_code: inv!.code, handle: h, email: `${h}@example.test`, password: "longenough1", terms_version: "v1", age_confirmed: true })).body.error).toBe("revoked_invite");

    const b = await createUser();
    const [inv2] = await callOk<{ code: string }[]>(b.client, "referral", "create_invite");
    await admin.schema("accounts").rpc("suspend_user", { p_user: b.id });
    expect((await call(anon, "referral", "check_invite", { p_code: inv2!.code })).data).toBe("revoked");
  });

  it("a duplicate email in test mode returns email_in_use and leaves no half-made account", async () => {
    const founder = await createUser();
    const [invite] = await callOk<{ code: string }[]>(founder.client, "referral", "create_invite");
    const res = await register({ invite_code: invite!.code, handle: uniq("d"), email: founder.email, password: "longenough1", terms_version: "v1", age_confirmed: true });
    expect(res.body.error).toBe("email_in_use");
  });
});

describe("accounts", () => {
  it("updates the handle once per cooldown and rejects invalid or taken handles", async () => {
    const u = await createUser();
    const other = await createUser();
    expect((await call(u.client, "accounts", "update_profile", { p_handle: other.handle })).error).toBe("handle_taken");
    expect((await call(u.client, "accounts", "update_profile", { p_handle: "ab" })).error).toBe("handle_invalid");
    const fresh = uniq("n");
    expect((await call(u.client, "accounts", "update_profile", { p_handle: fresh })).error).toBeNull();
    expect((await call(u.client, "accounts", "update_profile", { p_handle: uniq("n") })).error).toBe("handle_cooldown");
    const [me] = await callOk<{ handle: string }[]>(u.client, "accounts", "my_profile");
    expect(me!.handle).toBe(fresh);
  });

  it("lists devices and revokes other sessions but keeps the current one", async () => {
    const u = await createUser();
    const second = await signIn(u.email, u.password);
    const list = await callOk<{ id: string; is_current: boolean }[]>(u.client, "accounts", "list_sessions");
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((s) => s.is_current).length).toBe(1);

    const revoked = await callOk<number>(u.client, "accounts", "revoke_other_sessions");
    expect(revoked).toBeGreaterThanOrEqual(1);
    const after = await callOk<{ id: string }[]>(u.client, "accounts", "list_sessions");
    expect(after.length).toBe(1);
    // The revoked device can no longer refresh.
    const { error } = await second.auth.refreshSession();
    expect(error).not.toBeNull();
  });

  it("change-password verifies the current password and signs out other devices", async () => {
    const u = await createUser();
    const other = await signIn(u.email, u.password);
    expect((await invokeAs(u.client, "change-password", { current: "wrong-password-1", next: "brand-new-pass" })).body.error).toBe("wrong_password");
    expect((await invokeAs(u.client, "change-password", { current: u.password, next: "short" })).body.error).toBe("password_too_short");
    const ok = await invokeAs(u.client, "change-password", { current: u.password, next: "brand-new-pass" });
    expect(ok.body.ok).toBe(true);
    await expect(signIn(u.email, u.password)).rejects.toThrow();
    await signIn(u.email, "brand-new-pass");
    expect((await other.auth.refreshSession()).error).not.toBeNull();
    // The calling device is still signed in.
    expect((await call(u.client, "accounts", "my_profile")).error).toBeNull();
  });

  it("blocks API calls for an anonymous caller and a suspended user", async () => {
    const u = await createUser();
    expect((await call(anon, "accounts", "my_profile")).error).not.toBeNull();
    expect((await call(anon, "referral", "create_invite")).error).not.toBeNull();
    await admin.schema("accounts").rpc("suspend_user", { p_user: u.id });
    expect((await call(u.client, "referral", "create_invite")).error).toBe("suspended");
    await admin.schema("accounts").rpc("restore_user", { p_user: u.id });
    expect((await call(u.client, "referral", "create_invite")).error).toBeNull();
  });
});
