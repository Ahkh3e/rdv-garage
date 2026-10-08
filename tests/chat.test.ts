import { describe, expect, it } from "vitest";
import { call, callOk, createCrew, createUser, invokeAs, sleep, sql, uniq, type TestUser } from "./helpers";

interface RoomRow {
  id: string;
  kind: string;
  name: string;
  status: string;
  role: string;
  muted: boolean;
  unread: number;
  can_moderate: boolean;
  crew_id: string | null;
  rdv_id: string | null;
  last_message: { body: string; handle: string } | null;
}
interface MessageRow { id: string; body: string; handle: string; sender_id: string }

const chat = (u: TestUser, fn: string, args: Record<string, unknown> = {}) => call(u.client, "chat", fn, args);
const chatOk = <T = unknown>(u: TestUser, fn: string, args: Record<string, unknown> = {}) => callOk<T>(u.client, "chat", fn, args);
const rooms = (u: TestUser) => chatOk<RoomRow[]>(u, "list_rooms");
const messages = (u: TestUser, room: string) => chatOk<MessageRow[]>(u, "list_messages", { p_room: room });
const send = (u: TestUser, room: string, body: string) => chat(u, "send_message", { p_room: room, p_body: body });
const sendOk = (u: TestUser, room: string, body: string) => chatOk<{ id: string }>(u, "send_message", { p_room: room, p_body: body });
const crewRoom = async (crewId: string) => (await sql<{ id: string }>("select id from chat.rooms where crew_id = $1", [crewId]))[0]!.id;
const memberIds = async (room: string) => (await sql<{ user_id: string }>("select user_id from chat.members where room_id = $1", [room])).map((r) => r.user_id);
const visibleRows = async (u: TestUser, room: string) => {
  const { data } = await u.client.schema("chat").from("messages").select("id").eq("room_id", room);
  return data?.length ?? 0;
};
const joinCrew = (u: TestUser, code: string) => callOk(u.client, "crews", "join_crew", { p_link_code: code });
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

const createRdv = (u: TestUser, crewIds: string[]) =>
  callOk<string>(u.client, "rdvs", "create_rdv", {
    p_title: "Sunday meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Waterfront",
    p_starts_at: hoursFromNow(5), p_ends_at: null, p_note: null, p_crew_ids: crewIds, p_radius_m: 150,
  });

async function setup() {
  const owner = await createUser();
  const admin = await createUser();
  const member = await createUser();
  const member2 = await createUser();
  const stranger = await createUser();
  const crew = await createCrew(owner);
  for (const u of [admin, member, member2]) await joinCrew(u, crew.link_code);
  await callOk(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: admin.id });
  const room = await crewRoom(crew.id);
  return { owner, admin, member, member2, stranger, crew, room };
}

describe("crew rooms", () => {
  it("creates a standing room with every crew and keeps members in step with the crew", async () => {
    const { owner, member, stranger, crew, room } = await setup();
    expect(new Set(await memberIds(room))).toContain(owner.id);
    expect(await memberIds(room)).toHaveLength(4);
    const mine = (await rooms(member)).find((r) => r.id === room)!;
    expect(mine).toMatchObject({ kind: "crew", crew_id: crew.id, role: "member", unread: 0, last_message: null, can_moderate: false });
    expect((await rooms(owner)).find((r) => r.id === room)!.can_moderate).toBe(true);
    expect(await rooms(stranger)).toEqual([]);
    await callOk(stranger.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect((await rooms(stranger)).map((r) => r.id)).toContain(room);
    await callOk(stranger.client, "crews", "leave_crew", { p_crew: crew.id });
    expect(await rooms(stranger)).toEqual([]);
  });

  it("backfilled crews have a room whose members are the crew members", async () => {
    const rows = await sql<{ n: string }>(
      "select count(*) n from crews.crews c where c.status = 'active' and not exists (select 1 from chat.rooms r where r.crew_id = c.id)");
    expect(Number(rows[0]!.n)).toBe(0);
    const diff = await sql<{ n: string }>(
      `select count(*) n from crews.members m join chat.rooms r on r.crew_id = m.crew_id
       where not exists (select 1 from chat.members x where x.room_id = r.id and x.user_id = m.user_id)`);
    expect(Number(diff[0]!.n)).toBe(0);
  });

  it("hides messages sent before a person joined, and again after they leave and return", async () => {
    const { owner, member, stranger, crew, room } = await setup();
    await sendOk(owner, room, "before");
    await sleep(20);
    await callOk(stranger.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect(await messages(stranger, room)).toEqual([]);
    expect(await visibleRows(stranger, room)).toBe(0);
    await sleep(20);
    await sendOk(owner, room, "after");
    expect((await messages(stranger, room)).map((m) => m.body)).toEqual(["after"]);
    expect((await messages(member, room)).map((m) => m.body)).toEqual(["after", "before"]);
    await callOk(stranger.client, "crews", "leave_crew", { p_crew: crew.id });
    expect((await chat(stranger, "list_messages", { p_room: room })).error).toBe("not_room_member");
    expect(await visibleRows(stranger, room)).toBe(0);
    await sleep(20);
    await sendOk(owner, room, "while away");
    await sleep(20);
    await callOk(stranger.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect(await messages(stranger, room)).toEqual([]);
  });

  it("stops a removed crew member from reading or sending at once", async () => {
    const { owner, admin, member, crew, room } = await setup();
    await sendOk(member, room, "hello");
    await callOk(admin.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    expect((await chat(member, "list_messages", { p_room: room })).error).toBe("not_room_member");
    expect((await send(member, room, "still here")).error).toBe("not_room_member");
    expect(await visibleRows(member, room)).toBe(0);
    expect((await sql("select 1 from chat.messages where body = 'hello'")).length).toBeGreaterThan(0);
    expect((await messages(owner, room)).map((m) => m.body)).toContain("hello");
  });

  it("cannot be left, deleted, or have members managed directly", async () => {
    const { owner, member, member2, room } = await setup();
    expect((await chat(member, "leave_room", { p_room: room })).error).toBe("room_fixed");
    expect((await chat(owner, "delete_room", { p_room: room })).error).toBe("room_fixed");
    expect((await chat(owner, "transfer_room", { p_room: room, p_user: member.id })).error).toBe("room_fixed");
    expect((await chat(owner, "add_room_member", { p_room: room, p_user: member.id })).error).toBe("room_fixed");
    expect((await chat(owner, "remove_room_member", { p_room: room, p_user: member2.id })).error).toBe("room_fixed");
  });

  it("is deleted with the crew, with its members and messages", async () => {
    const { owner, member, crew, room } = await setup();
    await sendOk(member, room, "gone soon");
    await callOk(owner.client, "crews", "delete_crew", { p_crew: crew.id });
    expect(await sql("select 1 from chat.rooms where id = $1", [room])).toHaveLength(0);
    expect(await sql("select 1 from chat.members where room_id = $1", [room])).toHaveLength(0);
    expect(await sql("select 1 from chat.messages where room_id = $1", [room])).toHaveLength(0);
    expect(await rooms(member)).toEqual([]);
  });
});

describe("invite rooms", () => {
  const make = async () => {
    const s = await setup();
    const other = await createUser();
    const otherCrew = await createCrew(other);
    await joinCrew(s.member, otherCrew.link_code);
    const id = await chatOk<string>(s.owner, "create_room", { p_name: "Late night", p_description: "Quiet roads", p_member_ids: [s.member.id] });
    return { ...s, other, otherCrew, id };
  };

  it("validates name, description and that every member shares a crew with the creator", async () => {
    const { owner, member, stranger } = await setup();
    const name = `room ${uniq()}`;
    expect((await chat(owner, "create_room", { p_name: "ab" })).error).toBe("room_name_invalid");
    expect((await chat(owner, "create_room", { p_name: "x".repeat(31) })).error).toBe("room_name_invalid");
    expect((await chat(owner, "create_room", { p_name: name, p_description: "x".repeat(141) })).error).toBe("room_description_invalid");
    expect((await chat(owner, "create_room", { p_name: name, p_member_ids: [stranger.id] })).error).toBe("no_shared_crew");
    expect((await chat(owner, "create_room", { p_name: name, p_member_ids: [member.id, stranger.id] })).error).toBe("no_shared_crew");
    expect(await sql("select 1 from chat.rooms where name = $1", [name])).toHaveLength(0);
    const id = await chatOk<string>(owner, "create_room", { p_name: name, p_member_ids: [member.id, owner.id, member.id] });
    expect(await memberIds(id)).toHaveLength(2);
    const row = (await rooms(owner)).find((r) => r.id === id)!;
    expect(row).toMatchObject({ kind: "invite", role: "owner", can_moderate: true });
    expect((await rooms(member)).find((r) => r.id === id)).toMatchObject({ role: "member", can_moderate: false });
  });

  it("is invisible to non-members and to removed members, and shows members each other's profile", async () => {
    const { owner, member, member2, stranger, other, id } = await make();
    await sendOk(owner, id, "secret");
    for (const outsider of [stranger, member2, other]) {
      expect((await chat(outsider, "list_messages", { p_room: id })).error).toBe("not_room_member");
      expect((await send(outsider, id, "hi")).error).toBe("not_room_member");
      expect((await chat(outsider, "list_room_members", { p_room: id })).error).toBe("not_room_member");
      expect((await chat(outsider, "mark_read", { p_room: id })).error).toBe("not_room_member");
      expect(await visibleRows(outsider, id)).toBe(0);
      const { data } = await outsider.client.schema("chat").from("rooms").select("id").eq("id", id);
      expect(data).toEqual([]);
      const { data: seen } = await outsider.client.schema("chat").from("members").select("user_id").eq("room_id", id);
      expect(seen).toEqual([]);
    }
    expect((await chat(stranger, "list_messages", { p_room: "00000000-0000-0000-0000-000000000000" })).error).toBe("room_not_found");
    const people = await chatOk<{ user_id: string; handle: string; role: string }[]>(member, "list_room_members", { p_room: id });
    expect(people.map((p) => p.handle).sort()).toEqual([owner.handle, member.handle].sort());
    expect(people.find((p) => p.user_id === owner.id)!.role).toBe("owner");

    await chatOk(owner, "remove_room_member", { p_room: id, p_user: member.id });
    expect((await chat(member, "list_messages", { p_room: id })).error).toBe("not_room_member");
    expect(await visibleRows(member, id)).toBe(0);
    expect((await rooms(member)).find((r) => r.id === id)).toBeUndefined();
  });

  it("lets people in an invite room see each other's profile without sharing a crew", async () => {
    const { owner, other, id } = await make();
    const visible = async (viewer: TestUser, target: TestUser) => {
      const { data } = await viewer.client.schema("accounts").from("profiles").select("id").eq("id", target.id);
      return data?.length ?? 0;
    };
    expect(await visible(other, owner)).toBe(0);
    const crewmate = await createUser();
    const crew = await createCrew(owner);
    await joinCrew(crewmate, crew.link_code);
    await chatOk(owner, "add_room_member", { p_room: id, p_user: crewmate.id });
    const outsider = await createUser();
    const outsiderCrew = await createCrew(outsider);
    await joinCrew(crewmate, outsiderCrew.link_code);
    const room2 = await chatOk<string>(crewmate, "create_room", { p_name: "Cross crew", p_member_ids: [outsider.id] });
    expect(await visible(outsider, crewmate)).toBe(1);
    expect(await visible(outsider, owner)).toBe(0);
    expect(room2).toBeTruthy();
  });

  it("shows an added member only messages sent after they were added", async () => {
    const { owner, member2, id } = await make();
    await sendOk(owner, id, "old");
    await sleep(20);
    await chatOk(owner, "add_room_member", { p_room: id, p_user: member2.id });
    expect(await messages(member2, id)).toEqual([]);
    await sleep(20);
    await sendOk(owner, id, "new");
    expect((await messages(member2, id)).map((m) => m.body)).toEqual(["new"]);
    expect((await rooms(member2)).find((r) => r.id === id)!.unread).toBe(1);
  });

  it("limits member management to the owner and to people who share a crew", async () => {
    const { owner, member, member2, stranger, id } = await make();
    expect((await chat(member, "add_room_member", { p_room: id, p_user: member2.id })).error).toBe("not_room_owner");
    expect((await chat(stranger, "add_room_member", { p_room: id, p_user: member2.id })).error).toBe("not_room_member");
    expect((await chat(owner, "add_room_member", { p_room: id, p_user: stranger.id })).error).toBe("no_shared_crew");
    expect((await chat(member, "remove_room_member", { p_room: id, p_user: owner.id })).error).toBe("not_room_owner");
    expect((await chat(stranger, "remove_room_member", { p_room: id, p_user: member.id })).error).toBe("not_room_member");
    expect((await chat(owner, "remove_room_member", { p_room: id, p_user: owner.id })).error).toBe("owner_must_transfer");
    expect((await chat(owner, "remove_room_member", { p_room: id, p_user: member2.id })).error).toBe("not_room_member");
    expect((await chat(member, "delete_room", { p_room: id })).error).toBe("not_room_owner");
    expect((await chat(member, "transfer_room", { p_room: id, p_user: member.id })).error).toBe("not_room_owner");
    expect(await memberIds(id)).toHaveLength(2);
  });

  it("transfers, lets members leave, makes the owner transfer first, and deletes", async () => {
    const { owner, member, id } = await make();
    expect((await chat(owner, "leave_room", { p_room: id })).error).toBe("owner_must_transfer");
    expect((await chat(owner, "transfer_room", { p_room: id, p_user: owner.id })).error).toBe("not_room_member");
    await chatOk(owner, "transfer_room", { p_room: id, p_user: member.id });
    expect((await rooms(member)).find((r) => r.id === id)!.role).toBe("owner");
    expect((await rooms(owner)).find((r) => r.id === id)!.role).toBe("member");
    await chatOk(owner, "leave_room", { p_room: id });
    expect((await rooms(owner)).find((r) => r.id === id)).toBeUndefined();
    await chatOk(member, "delete_room", { p_room: id });
    expect(await sql("select 1 from chat.rooms where id = $1", [id])).toHaveLength(0);
  });

  it("deletes messages by the sender or the room owner only", async () => {
    const { owner, member, member2, stranger, id } = await make();
    await chatOk(owner, "add_room_member", { p_room: id, p_user: member2.id });
    const own = await sendOk(member, id, "mine");
    const other = await sendOk(member2, id, "theirs");
    expect((await chat(member, "delete_message", { p_message: other.id })).error).toBe("not_room_owner");
    expect((await chat(stranger, "delete_message", { p_message: other.id })).error).toBe("message_not_found");
    await chatOk(member, "delete_message", { p_message: own.id });
    await chatOk(owner, "delete_message", { p_message: other.id });
    expect(await messages(owner, id)).toEqual([]);
    expect((await chat(owner, "delete_message", { p_message: own.id })).error).toBe("message_not_found");
  });
});

describe("messages", () => {
  it("validates length and room state, and returns stable codes", async () => {
    const { member, room } = await setup();
    expect((await send(member, room, "")).error).toBe("message_invalid");
    expect((await send(member, room, "   ")).error).toBe("message_invalid");
    expect((await send(member, room, "x".repeat(1001))).error).toBe("message_invalid");
    expect((await send(member, room, "x".repeat(1000))).error).toBeNull();
    expect((await send(member, "00000000-0000-0000-0000-000000000000", "hi")).error).toBe("room_not_found");
  });

  it("allows no direct writes", async () => {
    const { member, room } = await setup();
    const msg = await sendOk(member, room, "hello");
    const insert = await member.client.schema("chat").from("messages").insert({ room_id: room, sender_id: member.id, body: "direct" });
    expect(insert.error).not.toBeNull();
    const update = await member.client.schema("chat").from("messages").update({ body: "edited" }).eq("id", msg.id);
    expect(update.error).not.toBeNull();
    const del = await member.client.schema("chat").from("messages").delete().eq("id", msg.id);
    expect(del.error).not.toBeNull();
    expect((await member.client.schema("chat").from("members").update({ blocked: true }).eq("room_id", room)).error).not.toBeNull();
    expect((await member.client.schema("chat").from("rooms").delete().eq("id", room)).error).not.toBeNull();
    expect((await messages(member, room)).map((m) => m.body)).toEqual(["hello"]);
  });

  it("does not expose read markers or mute flags of other members", async () => {
    const { member, room } = await setup();
    const { error } = await member.client.schema("chat").from("members").select("muted").eq("room_id", room);
    expect(error).not.toBeNull();
    const { error: ok } = await member.client.schema("chat").from("members").select("user_id, role").eq("room_id", room);
    expect(ok).toBeNull();
  });

  it("keeps messages only for the configured number of days", async () => {
    const { owner, member, room } = await setup();
    const old = await sendOk(owner, room, "old");
    const fresh = await sendOk(owner, room, "fresh");
    await sql("update chat.members set joined_at = now() - interval '30 days', last_read_at = now() - interval '30 days' where room_id = $1", [room]);
    await sql("update chat.messages set created_at = now() - interval '8 days' where id = $1", [old.id]);
    expect((await messages(member, room)).map((m) => m.body)).toEqual(["fresh"]);
    expect(await visibleRows(member, room)).toBe(1);
    expect((await rooms(member)).find((r) => r.id === room)!.unread).toBe(1);
    await sql("update private.settings set value = '10' where key = 'chat_message_ttl_days'");
    try {
      expect((await messages(member, room)).map((m) => m.body)).toEqual(["fresh", "old"]);
      expect(await visibleRows(member, room)).toBe(2);
    } finally {
      await sql("update private.settings set value = '7' where key = 'chat_message_ttl_days'");
    }
    const expired = await sql<{ n: number }>("select chat.expire_messages() n");
    expect(expired[0]!.n).toBeGreaterThanOrEqual(1);
    expect(await sql("select 1 from chat.messages where id = $1", [old.id])).toHaveLength(0);
    expect(await sql("select 1 from chat.messages where id = $1", [fresh.id])).toHaveLength(1);
  });

  it("pages with a before marker", async () => {
    const { owner, member, room } = await setup();
    for (let i = 0; i < 5; i++) {
      await sendOk(owner, room, `m${i}`);
      await sleep(5);
    }
    const first = await chatOk<MessageRow[]>(member, "list_messages", { p_room: room, p_limit: 2 });
    expect(first.map((m) => m.body)).toEqual(["m4", "m3"]);
    const all = await sql<{ created_at: string; body: string }>("select body, created_at from chat.messages where body = 'm3' and room_id = $1", [room]);
    const next = await chatOk<MessageRow[]>(member, "list_messages", { p_room: room, p_before: all[0]!.created_at, p_limit: 2 });
    expect(next.map((m) => m.body)).toEqual(["m2", "m1"]);
  });

  it("counts unread from others after the read marker, and mutes without losing the count", async () => {
    const { owner, member, room } = await setup();
    await sendOk(owner, room, "one");
    await sendOk(member, room, "mine");
    await sendOk(owner, room, "two");
    let row = (await rooms(member)).find((r) => r.id === room)!;
    expect(row.unread).toBe(2);
    expect(row.last_message).toMatchObject({ body: "two", handle: owner.handle });
    await chatOk(member, "set_room_muted", { p_room: room, p_muted: true });
    row = (await rooms(member)).find((r) => r.id === room)!;
    expect(row).toMatchObject({ muted: true, unread: 2 });
    await sleep(10);
    await chatOk(member, "mark_read", { p_room: room });
    expect((await rooms(member)).find((r) => r.id === room)!.unread).toBe(0);
    await sendOk(owner, room, "three");
    expect((await rooms(member)).find((r) => r.id === room)!.unread).toBe(1);
  });

  it("rate limits sending per account", async () => {
    const { member, member2, room } = await setup();
    for (let i = 0; i < 30; i++) expect((await send(member, room, `m${i}`)).error).toBeNull();
    expect((await send(member, room, "one more")).error).toBe("rate_limited");
    expect((await send(member2, room, "someone else")).error).toBeNull();
  });
});

describe("moderation by role", () => {
  it("lets the sender, the crew owner and admins delete in a crew room, and no one else", async () => {
    const { owner, admin, member, member2, stranger, room } = await setup();
    const fromMember = () => sendOk(member, room, "text");
    const cases: [TestUser, string | null][] = [
      [member, null], [owner, null], [admin, null], [member2, "not_moderator"], [stranger, "message_not_found"],
    ];
    for (const [who, expected] of cases) {
      const msg = await fromMember();
      expect((await chat(who, "delete_message", { p_message: msg.id })).error).toBe(expected);
      if (expected) await chatOk(member, "delete_message", { p_message: msg.id });
    }
    const adminMsg = await sendOk(admin, room, "admin says");
    expect((await chat(member2, "delete_message", { p_message: adminMsg.id })).error).toBe("not_moderator");
    await chatOk(owner, "delete_message", { p_message: adminMsg.id });
    expect(await messages(owner, room)).toEqual([]);
  });

  describe("RDV rooms", () => {
    const rdvSetup = async () => {
      const s = await setup();
      const host = await createUser();
      await joinCrew(host, s.crew.link_code);
      const other = await createUser();
      const otherCrew = await createCrew(other);
      await joinCrew(s.member, otherCrew.link_code);
      const rdv = await createRdv(host, [s.crew.id]);
      return { ...s, host, other, otherCrew, rdv };
    };
    const rsvp = (u: TestUser, rdv: string, answer: string) => callOk(u.client, "rdvs", "set_rsvp", { p_rdv: rdv, p_answer: answer });

    it("lets only the host open it, before the RDV ends, and keeps members in step with going and maybe", async () => {
      const { host, member, member2, admin, stranger, rdv } = await rdvSetup();
      expect((await chat(member, "open_rdv_room", { p_rdv: rdv })).error).toBe("not_host");
      expect((await chat(stranger, "open_rdv_room", { p_rdv: rdv })).error).toBe("rdv_not_found");
      await rsvp(member, rdv, "going");
      await rsvp(member2, rdv, "cant");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      expect(await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv })).toBe(room);
      expect(new Set(await memberIds(room))).toEqual(new Set([host.id, member.id]));
      await rsvp(member2, rdv, "maybe");
      expect(await memberIds(room)).toContain(member2.id);
      await rsvp(member2, rdv, "cant");
      expect(await memberIds(room)).not.toContain(member2.id);
      expect((await chat(member2, "list_messages", { p_room: room })).error).toBe("not_room_member");
      await rsvp(admin, rdv, "going");
      expect(await memberIds(room)).toContain(admin.id);
      expect((await rooms(member)).find((r) => r.id === room)).toMatchObject({ kind: "rdv", name: "Sunday meet", rdv_id: rdv });
      expect((await chat(member, "leave_room", { p_room: room })).error).toBe("room_fixed");
      expect((await chat(host, "delete_room", { p_room: room })).error).toBe("room_fixed");
    });

    it("refuses to open once the RDV has ended or been cancelled", async () => {
      const { host, rdv, member } = await rdvSetup();
      const second = await createRdv(host, [(await sql<{ crew_id: string }>("select crew_id from rdvs.crews where rdv_id = $1", [rdv]))[0]!.crew_id]);
      await callOk(host.client, "rdvs", "cancel_rdv", { p_rdv: second });
      expect((await chat(host, "open_rdv_room", { p_rdv: second })).error).toBe("rdv_closed");
      await sql("update rdvs.rdvs set starts_at = now() - interval '5 hours' where id = $1", [rdv]);
      expect((await chat(host, "open_rdv_room", { p_rdv: rdv })).error).toBe("rdv_closed");
      expect(member).toBeTruthy();
    });

    it("applies the moderation rules as host, admin, owner, member and non-member", async () => {
      const { host, owner, admin, member, member2, stranger, rdv } = await rdvSetup();
      for (const u of [member, member2, admin]) await rsvp(u, rdv, "going");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      const fromMember = () => sendOk(member, room, "text");
      const cases: [TestUser, string | null][] = [
        [host, null], [admin, null], [owner, null], [member2, "not_moderator"], [stranger, "message_not_found"],
      ];
      for (const [who, expected] of cases) {
        const msg = await fromMember();
        expect((await chat(who, "delete_message", { p_message: msg.id })).error).toBe(expected);
        if (expected) await chatOk(member, "delete_message", { p_message: msg.id });
      }
      expect((await chat(member2, "remove_room_member", { p_room: room, p_user: member.id })).error).toBe("not_moderator");
      expect((await chat(stranger, "remove_room_member", { p_room: room, p_user: member.id })).error).toBe("not_room_member");
      expect((await chat(admin, "remove_room_member", { p_room: room, p_user: host.id })).error).toBe("cannot_moderate_host");
      expect((await chat(admin, "remove_room_member", { p_room: room, p_user: stranger.id })).error).toBe("not_room_member");
      expect((await rooms(admin)).find((r) => r.id === room)!.can_moderate).toBe(true);
      expect((await rooms(member)).find((r) => r.id === room)!.can_moderate).toBe(false);
    });

    it("blocks a removed member even while their RSVP stays, and keeps them blocked after changing it", async () => {
      const { host, admin, member, member2, rdv } = await rdvSetup();
      await rsvp(member, rdv, "going");
      await rsvp(member2, rdv, "going");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      await sendOk(member, room, "before block");
      await rsvp(admin, rdv, "going");
      await chatOk(admin, "remove_room_member", { p_room: room, p_user: member.id });
      expect((await chat(member, "list_messages", { p_room: room })).error).toBe("not_room_member");
      expect((await send(member, room, "hello?")).error).toBe("not_room_member");
      expect(await visibleRows(member, room)).toBe(0);
      expect((await rooms(member)).find((r) => r.id === room)).toBeUndefined();
      const rsvpKept = await sql("select 1 from rdvs.rsvps where rdv_id = $1 and user_id = $2", [rdv, member.id]);
      expect(rsvpKept).toHaveLength(1);
      await rsvp(member, rdv, "maybe");
      expect((await send(member, room, "back?")).error).toBe("not_room_member");
      const people = await chatOk<{ user_id: string }[]>(member2, "list_room_members", { p_room: room });
      expect(people.map((p) => p.user_id)).not.toContain(member.id);
    });

    it("drops a member who leaves every crew of the RDV", async () => {
      const { host, member, crew, rdv } = await rdvSetup();
      await rsvp(member, rdv, "going");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      expect(await memberIds(room)).toContain(member.id);
      await callOk(member.client, "crews", "leave_crew", { p_crew: crew.id });
      expect(await memberIds(room)).not.toContain(member.id);
    });

    it("closes when the RDV ends or is cancelled, stays readable, and refuses new messages", async () => {
      const { host, member, rdv } = await rdvSetup();
      await rsvp(member, rdv, "going");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      await sendOk(member, room, "see you there");
      await sql("update rdvs.rdvs set starts_at = now() - interval '5 hours' where id = $1", [rdv]);
      const closed = await sql<{ n: number }>("select chat.close_finished_rdv_rooms() n");
      expect(closed[0]!.n).toBeGreaterThanOrEqual(1);
      expect((await send(member, room, "late")).error).toBe("room_closed");
      expect((await messages(member, room)).map((m) => m.body)).toEqual(["see you there"]);
      expect((await rooms(member)).find((r) => r.id === room)).toMatchObject({ status: "closed", last_message: { body: "see you there" } });
      await sql("update chat.messages set created_at = now() - interval '8 days' where room_id = $1", [room]);
      await sql("select chat.expire_messages()");
      expect(await sql("select 1 from chat.rooms where id = $1", [room])).toHaveLength(0);
    });

    it("closes when the host cancels the RDV", async () => {
      const { host, member, rdv } = await rdvSetup();
      await rsvp(member, rdv, "going");
      const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
      await callOk(host.client, "rdvs", "cancel_rdv", { p_rdv: rdv });
      await sql("select chat.close_finished_rdv_rooms()");
      expect((await send(member, room, "late")).error).toBe("room_closed");
    });
  });
});

describe("account deletion", () => {
  it("removes the person's messages and memberships", async () => {
    const { owner, member, crew, room } = await setup();
    await sendOk(member, room, "mine");
    await sendOk(owner, room, "theirs");
    const invite = await chatOk<string>(owner, "create_room", { p_name: "Private bunch", p_member_ids: [member.id] });
    await sendOk(member, invite, "also mine");
    expect((await invokeAs(member.client, "delete-account")).body.ok).toBe(true);
    expect(await sql("select 1 from chat.messages where sender_id = $1", [member.id])).toHaveLength(0);
    expect(await sql("select 1 from chat.members where user_id = $1", [member.id])).toHaveLength(0);
    expect((await messages(owner, room)).map((m) => m.body)).toEqual(["theirs"]);
    expect(await sql("select 1 from chat.rooms where id = $1", [invite])).toHaveLength(1);
    expect(crew.id).toBeTruthy();
  });

  it("passes an owned invite room to its longest-standing member, or deletes it when empty", async () => {
    const { owner, member, member2, room } = await setup();
    const shared = await chatOk<string>(member, "create_room", { p_name: "Passed on", p_member_ids: [owner.id] });
    await sleep(20);
    await chatOk(member, "add_room_member", { p_room: shared, p_user: member2.id });
    const alone = await chatOk<string>(member, "create_room", { p_name: "Only me" });
    await sendOk(member, alone, "bye");
    expect((await invokeAs(member.client, "delete-account")).body.ok).toBe(true);
    const roles = await sql<{ user_id: string; role: string }>("select user_id, role from chat.members where room_id = $1", [shared]);
    expect(roles.find((r) => r.role === "owner")!.user_id).toBe(owner.id);
    expect(roles).toHaveLength(2);
    expect(await sql("select 1 from chat.rooms where id = $1", [alone])).toHaveLength(0);
    expect(await sql("select 1 from chat.messages where room_id = $1", [alone])).toHaveLength(0);
    expect(room).toBeTruthy();
  });

  it("cancels the RDV of a deleted host, which closes its room", async () => {
    const { crew, member, owner } = await setup();
    const host = await createUser();
    await joinCrew(host, crew.link_code);
    const rdv = await createRdv(host, [crew.id]);
    await callOk(member.client, "rdvs", "set_rsvp", { p_rdv: rdv, p_answer: "going" });
    const room = await chatOk<string>(host, "open_rdv_room", { p_rdv: rdv });
    await sendOk(host, room, "bye");
    await invokeAs(host.client, "delete-account");
    await sql("select chat.close_finished_rdv_rooms()");
    expect((await send(member, room, "late")).error).toBe("room_closed");
    expect(await sql("select 1 from chat.messages where room_id = $1", [room])).toHaveLength(0);
    expect(owner.id).toBeTruthy();
  });
});

describe("inbox channel", () => {
  const subscribe = (u: TestUser, topic: string) =>
    new Promise<{ status: string; events: unknown[]; stop: () => Promise<unknown> }>((resolve) => {
      const events: unknown[] = [];
      const channel = u.client.channel(topic, { config: { private: true } });
      channel.on("broadcast", { event: "message" }, (m) => events.push(m.payload));
      channel.on("broadcast", { event: "message_deleted" }, (m) => events.push(m.payload));
      channel.subscribe((status) => {
        if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) resolve({ status, events, stop: () => u.client.removeChannel(channel) });
      });
    });

  it("delivers a new message to each member's own inbox only, and lets nobody join another's", async () => {
    const { owner, member, stranger, room } = await setup();
    const mine = await subscribe(member, `inbox:${member.id}`);
    const outsider = await subscribe(stranger, `inbox:${stranger.id}`);
    const spy = await subscribe(stranger, `inbox:${member.id}`);
    expect(mine.status).toBe("SUBSCRIBED");
    expect(outsider.status).toBe("SUBSCRIBED");
    expect(spy.status).not.toBe("SUBSCRIBED");
    const sent = await sendOk(owner, room, "hello inbox");
    for (let i = 0; i < 40 && mine.events.length === 0; i++) await sleep(100);
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]).toMatchObject({ room_id: room, message_id: sent.id, sender_id: owner.id, handle: owner.handle, text: "hello inbox" });
    expect(outsider.events).toEqual([]);
    expect(spy.events).toEqual([]);
    await Promise.all([mine.stop(), outsider.stop(), spy.stop()]);
  });

  it("does not let a client send to anyone's inbox", async () => {
    const { owner, member } = await setup();
    const listener = await subscribe(member, `inbox:${member.id}`);
    const sender = owner.client.channel(`inbox:${member.id}`, { config: { private: true } });
    await new Promise<void>((resolve) => sender.subscribe(() => resolve()));
    await sender.send({ type: "broadcast", event: "message", payload: { text: "forged" } }).catch(() => undefined);
    await sleep(800);
    expect(listener.events).toEqual([]);
    await Promise.all([listener.stop(), owner.client.removeChannel(sender)]);
  });
});

describe("terms", () => {
  it("accepts only the current version", async () => {
    const u = await createUser();
    expect((await call(u.client, "accounts", "accept_terms", { p_version: "v1" })).error).toBe("terms_required");
    await callOk(u.client, "accounts", "accept_terms", { p_version: "v2" });
    const [me] = await callOk<{ terms_version: string }[]>(u.client, "accounts", "my_profile");
    expect(me!.terms_version).toBe("v2");
  });
});
