import { describe, expect, it } from "vitest";
import { admin, callOk, createCrew, createUser, invokeAs, sql } from "./helpers";

describe("account deletion", () => {
  it("transfers an owned crew, revokes invites, removes live data, and keeps the referral chain", async () => {
    const parent = await createUser();
    const owner = await createUser(undefined, parent.id);
    const heir = await createUser();
    const crew = await createCrew(owner);
    await callOk(heir.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const [inv] = await callOk<{ id: string }[]>(owner.client, "referral", "create_invite");
    const child = await createUser(undefined, owner.id);
    const sid = await callOk<string>(owner.client, "live", "start_session", { p_crew_ids: [crew.id] });
    await callOk(owner.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 120, p_distance_m: 5 });

    const res = await invokeAs(owner.client, "delete-account");
    expect(res.body.ok).toBe(true);

    const [profile] = await sql<{ status: string; handle: string; invited_by: string }>("select status, handle, invited_by from accounts.profiles where id = $1", [owner.id]);
    expect(profile!.status).toBe("deleted");
    expect(profile!.handle).toMatch(/^deleted_[0-9a-f]{10}$/);
    expect(profile!.invited_by).toBe(parent.id);

    const [childRow] = await sql<{ invited_by: string }>("select invited_by from accounts.profiles where id = $1", [child.id]);
    expect(childRow!.invited_by).toBe(owner.id);

    const crewRows = await sql<{ owner_id: string; status: string }>("select owner_id, status from crews.crews where id = $1", [crew.id]);
    expect(crewRows[0]).toEqual({ owner_id: heir.id, status: "active" });
    expect((await sql("select 1 from live.sessions where user_id = $1", [owner.id])).length).toBe(0);
    const [invRow] = await sql<{ status: string; revoked_by: string }>("select status, revoked_by from referral.invites where id = $1", [inv!.id]);
    expect(invRow!.status).toBe("revoked");
    const { data: authUser } = await admin.auth.admin.getUserById(owner.id);
    expect(authUser.user).toBeNull();
  });

  it("dissolves a crew when the owner is the only member", async () => {
    const owner = await createUser();
    const crew = await createCrew(owner);
    await invokeAs(owner.client, "delete-account");
    const [row] = await sql<{ status: string; link_code: string | null }>("select status, link_code from crews.crews where id = $1", [crew.id]);
    expect(row).toEqual({ status: "dissolved", link_code: null });
  });

  it("requires a signed-in caller", async () => {
    const res = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:54321"}/functions/v1/delete-account`, { method: "POST" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("suspension", () => {
  it("revokes invites, ends live sessions, hands off an owned crew to an active member", async () => {
    const owner = await createUser();
    const heir = await createUser();
    const crew = await createCrew(owner);
    await callOk(heir.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const [inv] = await callOk<{ id: string }[]>(owner.client, "referral", "create_invite");
    const sid = await callOk<string>(owner.client, "live", "start_session", { p_crew_ids: [crew.id] });

    await admin.schema("accounts").rpc("suspend_user", { p_user: owner.id });
    const [invRow] = await sql<{ status: string; revoked_by: string }>("select status, revoked_by from referral.invites where id = $1", [inv!.id]);
    expect(invRow).toEqual({ status: "revoked", revoked_by: "suspension" });
    const [ses] = await sql<{ ended_at: string | null }>("select ended_at from live.sessions where id = $1", [sid]);
    expect(ses!.ended_at).not.toBeNull();
    const [c] = await sql<{ owner_id: string }>("select owner_id from crews.crews where id = $1", [crew.id]);
    expect(c!.owner_id).toBe(heir.id);
  });
});

describe("cleanup of unfinished accounts", () => {
  it("removes unconfirmed accounts after 24 hours and profile-less auth users after an hour", async () => {
    const { data: unconfirmed } = await admin.auth.admin.createUser({ email: `${Date.now()}a@example.test`, password: "longenough1", email_confirm: false });
    await admin.schema("accounts").rpc("create_profile", { p_id: unconfirmed.user!.id, p_handle: `unc${Date.now() % 100000}`, p_invited_by: null, p_invite_id: null, p_terms_version: "v1", p_synthetic: true });
    await sql("update auth.users set created_at = now() - interval '25 hours' where id = $1", [unconfirmed.user!.id]);

    const { data: orphan } = await admin.auth.admin.createUser({ email: `${Date.now()}b@example.test`, password: "longenough1", email_confirm: true });
    await sql("update auth.users set created_at = now() - interval '2 hours' where id = $1", [orphan.user!.id]);

    const { data: fresh } = await admin.auth.admin.createUser({ email: `${Date.now()}c@example.test`, password: "longenough1", email_confirm: true });

    const n = await callOk<number>(admin, "accounts", "cleanup_unconfirmed");
    expect(n).toBeGreaterThanOrEqual(2);
    expect((await admin.auth.admin.getUserById(unconfirmed.user!.id)).data.user).toBeNull();
    expect((await admin.auth.admin.getUserById(orphan.user!.id)).data.user).toBeNull();
    expect((await admin.auth.admin.getUserById(fresh.user!.id)).data.user).not.toBeNull();
    expect((await sql("select 1 from accounts.profiles where id = $1", [unconfirmed.user!.id])).length).toBe(0);
    await admin.auth.admin.deleteUser(fresh.user!.id);
  });
});
