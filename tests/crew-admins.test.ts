import { describe, expect, it } from "vitest";
import { call, callOk, createCrew, createUser, sql, type TestUser } from "./helpers";

interface CrewRow { id: string; role: string; link_code: string | null; members: { user_id: string; role: string }[] }

const roleOf = async (crewId: string, userId: string) =>
  (await sql<{ role: string }>("select role from crews.members where crew_id = $1 and user_id = $2", [crewId, userId]))[0]?.role ?? null;

async function setup() {
  const owner = await createUser();
  const admin = await createUser();
  const admin2 = await createUser();
  const member = await createUser();
  const member2 = await createUser();
  const stranger = await createUser();
  const crew = await createCrew(owner);
  for (const u of [admin, admin2, member, member2]) await callOk(u.client, "crews", "join_crew", { p_link_code: crew.link_code });
  await callOk(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: admin.id });
  await callOk(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: admin2.id });
  return { owner, admin, admin2, member, member2, stranger, crew };
}

const rm = (u: TestUser, crew: string, user: string) => call(u.client, "crews", "remove_member", { p_crew: crew, p_user: user });

describe("promote and demote", () => {
  it("lets only the owner add and remove admins, and shows the role to the crew", async () => {
    const { owner, admin, member, member2, stranger, crew } = await setup();
    expect(await roleOf(crew.id, admin.id)).toBe("admin");
    const view = await callOk<CrewRow[]>(member.client, "crews", "list_my_crews");
    expect(view[0]!.members.find((m) => m.user_id === admin.id)!.role).toBe("admin");
    expect(view[0]!.link_code).toBeNull();
    expect((await callOk<CrewRow[]>(admin.client, "crews", "list_my_crews"))[0]!.link_code).toBeNull();

    for (const fn of ["promote_admin", "demote_admin"]) {
      for (const who of [admin, member, stranger]) {
        expect((await call(who.client, "crews", fn, { p_crew: crew.id, p_user: member2.id })).error).toBe("not_owner");
      }
    }
    expect(await roleOf(crew.id, member2.id)).toBe("member");

    await callOk(owner.client, "crews", "demote_admin", { p_crew: crew.id, p_user: admin.id });
    expect(await roleOf(crew.id, admin.id)).toBe("member");
    expect((await rm(admin, crew.id, member2.id)).error).toBe("not_moderator");
  });

  it("only applies to current non-owner members and keeps one owner", async () => {
    const { owner, stranger, crew } = await setup();
    expect((await call(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: stranger.id })).error).toBe("not_a_member");
    expect((await call(owner.client, "crews", "demote_admin", { p_crew: crew.id, p_user: stranger.id })).error).toBe("not_a_member");
    expect((await call(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: owner.id })).error).toBe("not_a_member");
    expect((await call(owner.client, "crews", "demote_admin", { p_crew: crew.id, p_user: owner.id })).error).toBe("not_a_member");
    expect(await roleOf(crew.id, owner.id)).toBe("owner");
    const owners = await sql("select 1 from crews.members where crew_id = $1 and role = 'owner'", [crew.id]);
    expect(owners).toHaveLength(1);
  });

  it("drops the role when an admin leaves or is removed", async () => {
    const { owner, admin, admin2, crew } = await setup();
    await callOk(admin.client, "crews", "leave_crew", { p_crew: crew.id });
    expect(await roleOf(crew.id, admin.id)).toBeNull();
    await callOk(admin.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect(await roleOf(crew.id, admin.id)).toBe("member");
    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: admin2.id });
    await callOk(admin2.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect(await roleOf(crew.id, admin2.id)).toBe("member");
  });

  it("keeps the old owner as a member and the promoted admin as owner on transfer", async () => {
    const { owner, admin, crew } = await setup();
    await callOk(owner.client, "crews", "transfer_ownership", { p_crew: crew.id, p_user: admin.id });
    expect(await roleOf(crew.id, admin.id)).toBe("owner");
    expect(await roleOf(crew.id, owner.id)).toBe("member");
  });
});

describe("remove_member", () => {
  it("lets the owner and admins remove plain members, nobody else", async () => {
    const { owner, admin, member, member2, stranger, crew } = await setup();
    expect((await rm(member, crew.id, member2.id)).error).toBe("not_moderator");
    expect((await rm(stranger, crew.id, member2.id)).error).toBe("not_moderator");
    await callOk(admin.client, "crews", "remove_member", { p_crew: crew.id, p_user: member2.id });
    expect(await roleOf(crew.id, member2.id)).toBeNull();
    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    expect(await roleOf(crew.id, member.id)).toBeNull();
  });

  it("stops an admin removing the owner or another admin, and lets the owner remove an admin", async () => {
    const { owner, admin, admin2, crew } = await setup();
    expect((await rm(admin, crew.id, owner.id)).error).toBe("cannot_moderate_admin");
    expect((await rm(admin, crew.id, admin2.id)).error).toBe("cannot_moderate_admin");
    expect(await roleOf(crew.id, owner.id)).toBe("owner");
    expect(await roleOf(crew.id, admin2.id)).toBe("admin");
    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: admin2.id });
    expect(await roleOf(crew.id, admin2.id)).toBeNull();
    expect((await rm(owner, crew.id, owner.id)).error).toBe("owner_must_transfer");
    expect((await rm(owner, crew.id, (await createUser()).id)).error).toBe("not_a_member");
  });
});

describe("owner-only actions", () => {
  it("refuses an admin", async () => {
    const { admin, member, crew } = await setup();
    expect((await call(admin.client, "crews", "regenerate_crew_link", { p_crew: crew.id })).error).toBe("not_owner");
    expect((await call(admin.client, "crews", "transfer_ownership", { p_crew: crew.id, p_user: member.id })).error).toBe("not_owner");
    expect((await call(admin.client, "crews", "delete_crew", { p_crew: crew.id })).error).toBe("not_owner");
    expect(await roleOf(crew.id, member.id)).toBe("member");
  });
});

describe("cancel_rdv and remove_pin", () => {
  const rdv = (u: TestUser, crewIds: string[]) =>
    callOk<string>(u.client, "rdvs", "create_rdv", {
      p_title: "Sunday meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Waterfront",
      p_starts_at: new Date(Date.now() + 5 * 3600000).toISOString(), p_ends_at: null, p_note: null, p_crew_ids: crewIds, p_radius_m: 150,
    });
  const pin = (u: TestUser, crewIds: string[]) =>
    callOk<string>(u.client, "places", "drop_pin", { p_label: "Meet spot", p_note: null, p_lat: 43.65, p_lng: -79.38, p_address: null, p_crew_ids: crewIds });

  it("lets owner and admin cancel an RDV of the crew, not a member or non-member", async () => {
    const { owner, admin, member, member2, stranger, crew } = await setup();
    const a = await rdv(member, [crew.id]);
    expect((await call(member2.client, "rdvs", "cancel_rdv", { p_rdv: a })).error).toBe("not_moderator");
    expect((await call(stranger.client, "rdvs", "cancel_rdv", { p_rdv: a })).error).toBe("rdv_not_found");
    expect((await call(admin.client, "rdvs", "cancel_rdv", { p_rdv: a })).error).toBeNull();
    const b = await rdv(member, [crew.id]);
    expect((await call(owner.client, "rdvs", "cancel_rdv", { p_rdv: b })).error).toBeNull();
    const c = await rdv(member, [crew.id]);
    expect((await call(member.client, "rdvs", "cancel_rdv", { p_rdv: c })).error).toBeNull();
  });

  it("gives an admin of another crew no power over an RDV", async () => {
    const { admin, member, crew } = await setup();
    const otherOwner = await createUser();
    const otherCrew = await createCrew(otherOwner);
    await callOk(admin.client, "crews", "join_crew", { p_link_code: otherCrew.link_code });
    const a = await rdv(member, [crew.id]);
    const b = await rdv(otherOwner, [otherCrew.id]);
    expect((await call(admin.client, "rdvs", "cancel_rdv", { p_rdv: b })).error).toBe("not_moderator");
    expect((await call(otherOwner.client, "rdvs", "cancel_rdv", { p_rdv: a })).error).toBe("rdv_not_found");
  });

  it("lets owner and admin remove a pin of the crew, not a member or non-member", async () => {
    const { owner, admin, member, member2, stranger, crew } = await setup();
    const a = await pin(member, [crew.id]);
    expect((await call(member2.client, "places", "remove_pin", { p_pin: a })).error).toBe("not_moderator");
    expect((await call(stranger.client, "places", "remove_pin", { p_pin: a })).error).toBe("pin_not_found");
    expect((await call(admin.client, "places", "remove_pin", { p_pin: a })).error).toBeNull();
    const b = await pin(member, [crew.id]);
    expect((await call(owner.client, "places", "remove_pin", { p_pin: b })).error).toBeNull();
    const c = await pin(member, [crew.id]);
    expect((await call(member.client, "places", "remove_pin", { p_pin: c })).error).toBeNull();
  });

  it("loses moderator power on leaving", async () => {
    const { admin, member, crew } = await setup();
    const a = await pin(member, [crew.id]);
    await callOk(admin.client, "crews", "leave_crew", { p_crew: crew.id });
    expect((await call(admin.client, "places", "remove_pin", { p_pin: a })).error).toBe("pin_not_found");
  });
});

describe("voice columns", () => {
  it("exist and default to null", async () => {
    const { member, crew } = await setup();
    const [row] = await sql<{ voice_revoked_at: unknown; voice_revoked_by: unknown }>("select voice_revoked_at, voice_revoked_by from crews.members where crew_id = $1 and user_id = $2", [crew.id, member.id]);
    expect(row).toEqual({ voice_revoked_at: null, voice_revoked_by: null });
  });
});

describe("remove_member on yourself", () => {
  it("behaves like leave_crew for admins, members and owners", async () => {
    const { owner, admin, member, crew } = await setup();
    expect((await rm(owner, crew.id, owner.id)).error).toBe("owner_must_transfer");
    expect(await roleOf(crew.id, owner.id)).toBe("owner");
    await callOk(admin.client, "crews", "remove_member", { p_crew: crew.id, p_user: admin.id });
    expect(await roleOf(crew.id, admin.id)).toBeNull();
    await callOk(member.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    expect(await roleOf(crew.id, member.id)).toBeNull();
    expect((await rm(member, crew.id, member.id)).error).toBe("not_a_member");
  });
});

describe("voice_revoked_by constraint", () => {
  it("is set null on delete", async () => {
    const [row] = await sql<{ delete_rule: string }>(
      `select rc.delete_rule from information_schema.referential_constraints rc where rc.constraint_name = 'members_voice_revoked_by_fkey'`,
    );
    expect(row!.delete_rule).toBe("SET NULL");
  });
});

describe("list_my_crews member order", () => {
  it("lists owner, then admins, then members, then by handle", async () => {
    const { owner, admin, admin2, member, member2, crew } = await setup();
    const view = await callOk<(CrewRow & { members: { user_id: string; handle: string; role: string }[] })[]>(member.client, "crews", "list_my_crews");
    const got = view[0]!.members;
    const rank = (r: string) => (r === "owner" ? 0 : r === "admin" ? 1 : 2);
    const expected = [...got].sort((a, b) => rank(a.role) - rank(b.role) || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
    expect(got.map((m) => m.user_id)).toEqual(expected.map((m) => m.user_id));
    expect(got.map((m) => m.role)).toEqual(["owner", "admin", "admin", "member", "member"]);
    expect(got[0]!.user_id).toBe(owner.id);
    expect(new Set(got.slice(1, 3).map((m) => m.user_id))).toEqual(new Set([admin.id, admin2.id]));
    expect(new Set(got.slice(3).map((m) => m.user_id))).toEqual(new Set([member.id, member2.id]));
  });
});
