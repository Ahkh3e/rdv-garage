import { describe, expect, it } from "vitest";
import { admin, API_URL, ANON_KEY, call, callOk, createCrew, createUser, invokeAs, sleep, sql, type TestUser } from "./helpers";
import { listenerGrant, liveKitAdmin, mintToken, participantIdentity, TOKEN_TTL_SECONDS } from "../supabase/functions/_shared/walkie";
import { issueToken, type Access } from "../supabase/functions/walkie_token/handler";
import { kick } from "../supabase/functions/walkie_kick/handler";

const IDENTITY_SECRET = "local-fake-identity-secret-0123456789abcdef0123456789abcdef";
const KICK_SECRET = "local-fake-kick-secret-0123456789abcdef";
const LIVEKIT_SECRET = "local_fake_livekit_secret_0123456789abcdef";
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

interface Claims { iss: string; sub: string; name: string; nbf: number; exp: number; video: Record<string, unknown> }
function decode(token: string): Claims {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

describe("walkie pure logic", () => {
  it("derives a participant id that is stable per room and differs across rooms, users and secrets", async () => {
    const a = await participantIdentity(IDENTITY_SECRET, USER, ROOM_A);
    expect(await participantIdentity(IDENTITY_SECRET, USER, ROOM_A)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await participantIdentity(IDENTITY_SECRET, USER, ROOM_B)).not.toBe(a);
    expect(await participantIdentity(IDENTITY_SECRET, "44444444-4444-4444-8444-444444444444", ROOM_A)).not.toBe(a);
    expect(await participantIdentity("another-secret", USER, ROOM_A)).not.toBe(a);
    expect(a).not.toContain(USER.slice(0, 8));
  });

  it("signs a five minute room token with an empty name and the right grants", async () => {
    const cfg = { url: "wss://x.example", apiKey: "key", apiSecret: LIVEKIT_SECRET };
    const listen = decode(await mintToken(cfg, "id1", listenerGrant(ROOM_A, false), 1000));
    expect(listen).toMatchObject({ iss: "key", sub: "id1", name: "" });
    expect(listen.exp - 1000).toBe(TOKEN_TTL_SECONDS);
    expect(listen.video).toMatchObject({ room: ROOM_A, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canPublishSources: [] });
    const talk = decode(await mintToken(cfg, "id1", listenerGrant(ROOM_A, true), 1000));
    expect(talk.video).toMatchObject({ canPublish: true, canPublishSources: ["microphone"] });
  });

  it("calls the server API with an admin token and treats an absent target as removed", async () => {
    const seen: { url: string; auth: string; agent: string; body: unknown }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      seen.push({ url, auth: headers.Authorization!, agent: headers["User-Agent"]!, body: JSON.parse(init.body as string) });
      return new Response("{}", { status: seen.length === 2 ? 404 : 200 });
    }) as unknown as typeof fetch;
    const admin = liveKitAdmin({ url: "wss://x.example/", apiKey: "key", apiSecret: LIVEKIT_SECRET }, fake);
    await admin.removeParticipant(ROOM_A, "id1");
    await admin.deleteRoom(ROOM_A);
    expect(seen[0]!.url).toBe("https://x.example/twirp/livekit.RoomService/RemoveParticipant");
    expect(seen[0]!.agent).toBe("Rendezview-walkie-server");
    expect(seen[0]!.body).toEqual({ room: ROOM_A, identity: "id1" });
    expect(seen[1]!.url).toBe("https://x.example/twirp/livekit.RoomService/DeleteRoom");
    const admin401 = liveKitAdmin({ url: "wss://x.example", apiKey: "key", apiSecret: LIVEKIT_SECRET }, (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    await expect(admin401.deleteRoom(ROOM_A)).rejects.toThrow();
    const claims = decode(seen[0]!.auth.replace("Bearer ", ""));
    expect(claims.video).toMatchObject({ roomAdmin: true, room: ROOM_A });
  });

  const cfg = { url: "wss://x.example", apiKey: "key", apiSecret: LIVEKIT_SECRET };
  const deps = (access: Access | null) => ({ livekit: cfg, identitySecret: IDENTITY_SECRET, access: async () => access, now: () => 2000 });

  it("maps access states to refusals and never mints for them", async () => {
    for (const [state, status] of [["room_not_found", 404], ["not_room_member", 403], ["room_closed", 409], ["suspended", 403]] as const) {
      expect(await issueToken({ room_id: ROOM_A }, USER, deps({ state }))).toEqual({ status, body: { error: state } });
    }
    expect((await issueToken({ room_id: "nope" }, USER, deps({ state: "ok" }))).status).toBe(400);
    expect((await issueToken(null, USER, deps({ state: "ok" }))).status).toBe(400);
    expect((await issueToken({ room_id: ROOM_A }, USER, deps(null))).body).toEqual({ error: "walkie_unavailable" });
    expect((await issueToken({ room_id: ROOM_A }, USER, { ...deps({ state: "ok" }), livekit: null })).status).toBe(503);
  });

  it("returns the url and grants with the token", async () => {
    const out = await issueToken({ room_id: ROOM_A }, USER, deps({ state: "ok", can_publish: false, voice_off_crews: ["Night Run"] }));
    const body = out.body as { token: string; url: string; can_publish: boolean; voice_off_crews: string[] };
    expect(out.status).toBe(200);
    expect(body).toMatchObject({ url: "wss://x.example", can_publish: false, voice_off_crews: ["Night Run"] });
    expect(decode(body.token).video).toMatchObject({ canPublish: false });
  });

  it("kick checks the shared secret, validates ids, and removes by the hashed id", async () => {
    const calls: string[][] = [];
    const admin = {
      async removeParticipant(room: string, identity: string) { calls.push(["remove", room, identity]); },
      async deleteRoom(room: string) { calls.push(["delete", room]); },
    };
    const d = { sharedSecret: KICK_SECRET, identitySecret: IDENTITY_SECRET, admin };
    expect((await kick(null, { room_id: ROOM_A }, d)).status).toBe(401);
    expect((await kick("wrong", { room_id: ROOM_A }, d)).status).toBe(401);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A }, { ...d, sharedSecret: null })).status).toBe(401);
    expect((await kick(KICK_SECRET, { room_id: "x" }, d)).status).toBe(400);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A, user_id: 5 }, d)).status).toBe(400);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A, user_id: USER }, d)).status).toBe(200);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A, user_id: USER }, d)).status).toBe(200);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A, user_id: null }, d)).status).toBe(200);
    const id = await participantIdentity(IDENTITY_SECRET, USER, ROOM_A);
    expect(calls).toEqual([["remove", ROOM_A, id], ["remove", ROOM_A, id], ["delete", ROOM_A]]);
    expect((await kick(KICK_SECRET, { room_id: ROOM_A }, { ...d, admin: null })).status).toBe(503);
    const failing = { ...d, admin: { removeParticipant: async () => { throw new Error("down"); }, deleteRoom: async () => { throw new Error("down"); } } };
    expect((await kick(KICK_SECRET, { room_id: ROOM_A }, failing)).status).toBe(502);
  });
});

const joinCrew = (u: TestUser, code: string) => callOk(u.client, "crews", "join_crew", { p_link_code: code });
const crewRoom = async (crewId: string) => (await sql<{ id: string }>("select id from chat.rooms where crew_id = $1", [crewId]))[0]!.id;
const token = (u: TestUser, room: string) => invokeAs(u.client, "walkie_token", { room_id: room });
const setVoice = (u: TestUser, crew: string, user: string, allowed: boolean) => call(u.client, "crews", "set_voice_access", { p_crew: crew, p_user: user, p_allowed: allowed });
const kicksFor = (room: string) => sql<{ user_id: string | null }>("select user_id from private.walkie_kicks where room_id = $1 order by id", [room]);
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

async function setup() {
  const owner = await createUser();
  const admin = await createUser();
  const admin2 = await createUser();
  const member = await createUser();
  const stranger = await createUser();
  const crew = await createCrew(owner);
  for (const u of [admin, admin2, member]) await joinCrew(u, crew.link_code);
  await callOk(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: admin.id });
  await callOk(owner.client, "crews", "promote_admin", { p_crew: crew.id, p_user: admin2.id });
  return { owner, admin, admin2, member, stranger, crew, room: await crewRoom(crew.id) };
}

describe("walkie_token", () => {
  it("requires a signed-in caller", async () => {
    const res = await fetch(`${API_URL}/functions/v1/walkie_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ room_id: ROOM_A }),
    });
    expect(res.status).toBe(401);
  });

  it("gives a member a five minute room token with no handle, crew or account in it", async () => {
    const { member, crew, room } = await setup();
    const res = await token(member, room);
    expect(res.status).toBe(200);
    const body = res.body as { token: string; url: string; can_publish: boolean };
    expect(body).toMatchObject({ can_publish: true, url: "ws://127.0.0.1:7880" });
    const claims = decode(body.token);
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(TOKEN_TTL_SECONDS + 5);
    expect(claims.video).toMatchObject({ room, canSubscribe: true, canPublish: true });
    expect(claims.name).toBe("");
    const raw = Buffer.from(body.token.split(".")[1]!, "base64url").toString("utf8");
    for (const secret of [member.id, member.handle, member.email, crew.id]) expect(raw).not.toContain(secret);
    expect(claims.sub).toBe(await participantIdentity(IDENTITY_SECRET, member.id, room));
  });

  it("returns the roster of current members keyed by participant id, to members only and never in the token", async () => {
    const { owner, member, stranger, room } = await setup();
    const res = await token(member, room);
    const body = res.body as { token: string; identities: Record<string, string> };
    const expected: Record<string, string> = {};
    const members = await sql<{ user_id: string }>("select user_id from chat.members where room_id = $1 and not blocked", [room]);
    for (const m of members) expected[await participantIdentity(IDENTITY_SECRET, m.user_id, room)] = m.user_id;
    expect(Object.keys(expected).length).toBe(4);
    expect(body.identities).toEqual(expected);
    expect(body.identities[decode(body.token).sub]).toBe(member.id);
    expect(Object.values(body.identities)).toContain(owner.id);
    const raw = Buffer.from(body.token.split(".")[1]!, "base64url").toString("utf8");
    expect(raw).not.toContain(owner.id);
    expect((await token(stranger, room)).body).not.toHaveProperty("identities");
  });

  it("validates the body before spending a rate-limit slot", async () => {
    const { member, room } = await setup();
    const used = async () => (await sql<{ count: number }>("select count from private.rate_limits where key = $1", [`walkie_token:${member.id}`]))[0]?.count ?? 0;
    expect(await used()).toBe(0);
    expect((await token(member, "not-a-uuid")).status).toBe(400);
    expect((await invokeAs(member.client, "walkie_token", {})).status).toBe(400);
    expect(await used()).toBe(0);
    expect((await token(member, room)).status).toBe(200);
    expect(await used()).toBe(1);
  });

  it("keeps the participant id stable inside a room and different across rooms", async () => {
    const { member, owner, crew } = await setup();
    const invite = await callOk<string>(owner.client, "chat", "create_room", { p_name: "Side channel", p_member_ids: [member.id] });
    const first = decode(((await token(member, await crewRoom(crew.id))).body as { token: string }).token).sub;
    const again = decode(((await token(member, await crewRoom(crew.id))).body as { token: string }).token).sub;
    const other = decode(((await token(member, invite)).body as { token: string }).token).sub;
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("refuses non-members, removed members, unknown rooms, closed rooms and suspended accounts", async () => {
    const { owner, member, stranger, crew, room } = await setup();
    expect(await token(stranger, room)).toMatchObject({ status: 403, body: { error: "not_room_member" } });
    expect(await token(member, "99999999-9999-4999-8999-999999999999")).toMatchObject({ status: 404, body: { error: "room_not_found" } });
    expect((await token(member, "not-a-uuid")).status).toBe(400);

    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    expect(await token(member, room)).toMatchObject({ status: 403, body: { error: "not_room_member" } });

    const host = await createUser();
    const guest = await createUser();
    await joinCrew(host, crew.link_code);
    await joinCrew(guest, crew.link_code);
    const rdv = await callOk<string>(host.client, "rdvs", "create_rdv", {
      p_title: "Sunday meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Waterfront",
      p_starts_at: hoursFromNow(5), p_ends_at: null, p_note: null, p_crew_ids: [crew.id], p_radius_m: 150,
    });
    await callOk(guest.client, "rdvs", "set_rsvp", { p_rdv: rdv, p_answer: "going" });
    const rdvRoom = await callOk<string>(host.client, "chat", "open_rdv_room", { p_rdv: rdv });
    expect((await token(guest, rdvRoom)).status).toBe(200);
    await sql("update rdvs.rdvs set status = 'cancelled' where id = $1", [rdv]);
    await sql("select chat.close_finished_rdv_rooms()");
    expect(await token(guest, rdvRoom)).toMatchObject({ status: 409, body: { error: "room_closed" } });

    const other = await createUser();
    await joinCrew(other, crew.link_code);
    expect((await token(other, room)).status).toBe(200);
    await callOk(admin, "accounts", "suspend_user", { p_user: other.id });
    expect(await token(other, room)).toMatchObject({ body: { error: "suspended" } });
  });

  it("rate limits per account", async () => {
    const { member, room } = await setup();
    await sql("insert into private.rate_limits (key, window_start, count) values ($1, now(), 240)", [`walkie_token:${member.id}`]);
    expect(await token(member, room)).toMatchObject({ status: 429, body: { error: "rate_limited" } });
  });

  it("withholds the publish grant from a voice-revoked member and returns the crew name", async () => {
    const { owner, member, crew, room } = await setup();
    expect((await setVoice(owner, crew.id, member.id, false)).error).toBeNull();
    const res = await token(member, room);
    expect(res.status).toBe(200);
    const body = res.body as { token: string; can_publish: boolean; voice_off_crews: string[] };
    expect(body.can_publish).toBe(false);
    expect(body.voice_off_crews).toHaveLength(1);
    expect(decode(body.token).video).toMatchObject({ canSubscribe: true, canPublish: false });
    await setVoice(owner, crew.id, member.id, true);
    expect(((await token(member, room)).body as { can_publish: boolean }).can_publish).toBe(true);
  });

  it("applies a revocation in any crew of a multi-crew RDV room, and leaves invite rooms alone", async () => {
    const a = await setup();
    const b = await setup();
    const traveller = await createUser();
    await joinCrew(traveller, a.crew.link_code);
    await joinCrew(traveller, b.crew.link_code);
    const rdv = await callOk<string>(traveller.client, "rdvs", "create_rdv", {
      p_title: "Joint meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Waterfront",
      p_starts_at: hoursFromNow(5), p_ends_at: null, p_note: null, p_crew_ids: [a.crew.id, b.crew.id], p_radius_m: 150,
    });
    const room = await callOk<string>(traveller.client, "chat", "open_rdv_room", { p_rdv: rdv });
    expect(((await token(traveller, room)).body as { can_publish: boolean }).can_publish).toBe(true);
    await setVoice(b.owner, b.crew.id, traveller.id, false);
    expect(((await token(traveller, room)).body as { can_publish: boolean }).can_publish).toBe(false);
    expect(await sql("select private.voice_allowed($1, $2) as ok", [room, traveller.id])).toEqual([{ ok: false }]);
    const invite = await callOk<string>(traveller.client, "chat", "create_room", { p_name: "No crew behind", p_member_ids: [] });
    expect(((await token(traveller, invite)).body as { can_publish: boolean }).can_publish).toBe(true);
    await setVoice(b.owner, b.crew.id, traveller.id, true);
    expect(await sql("select private.voice_allowed($1, $2) as ok", [room, traveller.id])).toEqual([{ ok: true }]);
  });
});

describe("set_voice_access", () => {
  it("lets the owner and admins change a member, and a member or outsider not", async () => {
    const { owner, admin, member, stranger, crew } = await setup();
    expect((await setVoice(owner, crew.id, member.id, false)).error).toBeNull();
    expect((await setVoice(admin, crew.id, member.id, true)).error).toBeNull();
    expect((await setVoice(admin, crew.id, member.id, false)).error).toBeNull();
    const row = await sql<{ voice_revoked_at: string | null; voice_revoked_by: string | null }>("select voice_revoked_at, voice_revoked_by from crews.members where crew_id = $1 and user_id = $2", [crew.id, member.id]);
    expect(row[0]!.voice_revoked_at).not.toBeNull();
    expect(row[0]!.voice_revoked_by).toBe(admin.id);
    expect((await setVoice(member, crew.id, owner.id, false)).error).toBe("not_moderator");
    expect((await setVoice(stranger, crew.id, member.id, false)).error).toBe("not_moderator");
    expect((await setVoice(owner, crew.id, stranger.id, false)).error).toBe("not_a_member");
    await setVoice(owner, crew.id, member.id, true);
    const cleared = await sql<{ voice_revoked_at: string | null; voice_revoked_by: string | null }>("select voice_revoked_at, voice_revoked_by from crews.members where crew_id = $1 and user_id = $2", [crew.id, member.id]);
    expect(cleared[0]).toEqual({ voice_revoked_at: null, voice_revoked_by: null });
  });

  it("stops an admin changing the owner or another admin, but not the owner changing an admin", async () => {
    const { owner, admin, admin2, crew } = await setup();
    expect((await setVoice(admin, crew.id, owner.id, false)).error).toBe("cannot_moderate_admin");
    expect((await setVoice(admin, crew.id, admin2.id, false)).error).toBe("cannot_moderate_admin");
    expect((await setVoice(owner, crew.id, admin2.id, false)).error).toBeNull();
  });

  it("is only visible to moderators and the person on the member list", async () => {
    const { owner, member, admin, crew } = await setup();
    await setVoice(owner, crew.id, member.id, false);
    type Row = { id: string; members: { user_id: string; voice_off: boolean }[] };
    const seen = async (u: TestUser) => (await callOk<Row[]>(u.client, "crews", "list_my_crews")).find((c) => c.id === crew.id)!.members.find((m) => m.user_id === member.id)!.voice_off;
    expect(await seen(owner)).toBe(true);
    expect(await seen(admin)).toBe(true);
    expect(await seen(member)).toBe(true);
    const bystander = await createUser();
    await joinCrew(bystander, crew.link_code);
    expect(await seen(bystander)).toBe(false);
  });

  it("lets nobody change their own voice access, so a revoked admin cannot restore themselves", async () => {
    const { owner, admin, crew } = await setup();
    expect((await setVoice(owner, crew.id, admin.id, false)).error).toBeNull();
    expect((await setVoice(admin, crew.id, admin.id, true)).error).toBe("cannot_moderate_admin");
    expect((await setVoice(owner, crew.id, owner.id, false)).error).toBe("cannot_moderate_admin");
    const row = await sql<{ voice_revoked_at: string | null }>("select voice_revoked_at from crews.members where crew_id = $1 and user_id = $2", [crew.id, admin.id]);
    expect(row[0]!.voice_revoked_at).not.toBeNull();
    expect((await setVoice(owner, crew.id, admin.id, true)).error).toBeNull();
  });

  it("needs an active crew and an active member", async () => {
    const { owner, member, crew } = await setup();
    await callOk(admin, "accounts", "suspend_user", { p_user: member.id });
    expect((await setVoice(owner, crew.id, member.id, false)).error).toBe("not_a_member");
    await sql("update crews.crews set status = 'dissolved' where id = $1", [crew.id]);
    expect((await setVoice(owner, crew.id, member.id, false)).error).toBe("not_moderator");
  });

  it("restoring voice queues no kick", async () => {
    const { owner, member, crew, room } = await setup();
    await setVoice(owner, crew.id, member.id, false);
    await sql("truncate private.walkie_kicks");
    expect((await setVoice(owner, crew.id, member.id, true)).error).toBeNull();
    expect(await kicksFor(room)).toEqual([]);
    expect(await sql("select 1 from private.walkie_kicks")).toEqual([]);
  });

  it("queues a kick of that person from the crew room, and from the crew's RDV room they are in", async () => {
    const { owner, member, crew, room } = await setup();
    await sql("truncate private.walkie_kicks");
    await setVoice(owner, crew.id, member.id, false);
    expect(await kicksFor(room)).toEqual([{ user_id: member.id }]);
  });
});

describe("kick queue", () => {
  it("is queued when a member is removed, leaves the crew, is blocked from an RDV room, or a room is deleted or closed", async () => {
    const { owner, member, crew, room } = await setup();
    const second = await createUser();
    await joinCrew(second, crew.link_code);
    await sql("truncate private.walkie_kicks");
    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    expect(await kicksFor(room)).toEqual([{ user_id: member.id }]);
    await callOk(second.client, "crews", "leave_crew", { p_crew: crew.id });
    expect((await kicksFor(room)).map((k) => k.user_id)).toEqual([member.id, second.id]);

    const invite = await callOk<string>(owner.client, "chat", "create_room", { p_name: "Small room", p_member_ids: [] });
    await callOk(owner.client, "crews", "delete_crew", { p_crew: crew.id });
    expect((await kicksFor(room)).map((k) => k.user_id)).toContain(null);
    await callOk(owner.client, "chat", "delete_room", { p_room: invite });
    expect(await kicksFor(invite)).toEqual([{ user_id: null }]);
  });

  it("covers a leave from an invite room and a block from an RDV room, and closes a finished RDV room", async () => {
    const { owner, member, crew } = await setup();
    const invite = await callOk<string>(owner.client, "chat", "create_room", { p_name: "Small room", p_member_ids: [member.id] });
    await sql("truncate private.walkie_kicks");
    await callOk(member.client, "chat", "leave_room", { p_room: invite });
    expect(await kicksFor(invite)).toEqual([{ user_id: member.id }]);

    const host = await createUser();
    const guest = await createUser();
    await joinCrew(host, crew.link_code);
    await joinCrew(guest, crew.link_code);
    const rdv = await callOk<string>(host.client, "rdvs", "create_rdv", {
      p_title: "Sunday meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Waterfront",
      p_starts_at: hoursFromNow(5), p_ends_at: null, p_note: null, p_crew_ids: [crew.id], p_radius_m: 150,
    });
    await callOk(guest.client, "rdvs", "set_rsvp", { p_rdv: rdv, p_answer: "going" });
    const rdvRoom = await callOk<string>(host.client, "chat", "open_rdv_room", { p_rdv: rdv });
    await callOk(host.client, "chat", "remove_room_member", { p_room: rdvRoom, p_user: guest.id });
    expect(await kicksFor(rdvRoom)).toEqual([{ user_id: guest.id }]);
    await sql("update rdvs.rdvs set starts_at = now() - interval '5 hours' where id = $1", [rdv]);
    await sql("select chat.close_finished_rdv_rooms()");
    expect(await kicksFor(rdvRoom)).toEqual([{ user_id: guest.id }, { user_id: null }]);
  });

  it("is carried to walkie_kick by the database with the shared secret", async () => {
    const { owner, member, crew } = await setup();
    await sql("truncate private.walkie_kicks");
    await setVoice(owner, crew.id, member.id, false);
    const [queued] = await sql<{ id: string }>("select id from private.walkie_kicks order by id desc limit 1");
    let status: number | null = null;
    for (let i = 0; i < 50 && status === null; i++) {
      const rows = await sql<{ status_code: number }>(
        "select r.status_code from private.walkie_kicks k join net._http_response r on r.id = k.request_id where k.id = $1", [queued!.id]);
      status = rows[0]?.status_code ?? null;
      if (status === null) await sleep(200);
    }
    expect([200, 502]).toContain(status);
  });

  const ageKick = (id: string, minutes: number) =>
    sql("update private.walkie_kicks set sent_at = now() - interval '2 minutes', created_at = now() - make_interval(mins => $2::int) where id = $1", [id, minutes]);
  const attempts = async (id: string) => (await sql<{ attempts: number }>("select attempts from private.walkie_kicks where id = $1", [id]))[0]?.attempts ?? null;

  it("sends a kick at once and again each retry while the person is still out, so an old token cannot rejoin", async () => {
    const { owner, member, crew, room } = await setup();
    await sql("truncate private.walkie_kicks");
    await setVoice(owner, crew.id, member.id, false);
    const [row] = await sql<{ id: string }>("select id from private.walkie_kicks where room_id = $1", [room]);
    expect(await attempts(row!.id)).toBe(1);
    await ageKick(row!.id, 1);
    await sql("select private.walkie_retry()");
    expect(await attempts(row!.id)).toBe(2);
    await ageKick(row!.id, 4);
    await sql("select private.walkie_retry()");
    expect(await attempts(row!.id)).toBe(3);
  });

  it("drops a kick for a person restored before the retry, and re-added people", async () => {
    const { owner, member, crew, room } = await setup();
    await sql("truncate private.walkie_kicks");
    await setVoice(owner, crew.id, member.id, false);
    const [row] = await sql<{ id: string }>("select id from private.walkie_kicks where room_id = $1", [room]);
    await setVoice(owner, crew.id, member.id, true);
    await ageKick(row!.id, 1);
    await sql("select private.walkie_retry()");
    expect(await attempts(row!.id)).toBeNull();

    await sql("truncate private.walkie_kicks");
    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: member.id });
    const [removed] = await sql<{ id: string }>("select id from private.walkie_kicks where room_id = $1", [room]);
    await ageKick(removed!.id, 1);
    await sql("select private.walkie_retry()");
    expect(await attempts(removed!.id)).toBe(2);
  });

  it("forgets a kick after six minutes", async () => {
    const { owner, member, crew, room } = await setup();
    await sql("truncate private.walkie_kicks");
    await setVoice(owner, crew.id, member.id, false);
    const [row] = await sql<{ id: string }>("select id from private.walkie_kicks where room_id = $1", [room]);
    await ageKick(row!.id, 7);
    await sql("select private.walkie_retry()");
    expect(await attempts(row!.id)).toBeNull();
  });

  it("is refused by walkie_kick without the secret", async () => {
    const res = await fetch(`${API_URL}/functions/v1/walkie_kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-walkie-secret": "wrong" },
      body: JSON.stringify({ room_id: ROOM_A }),
    });
    expect(res.status).toBe(401);
  });
});

describe("walkie channel", () => {
  it("no longer exists: nobody, member or not, can use a walkie:<room_id> broadcast channel", async () => {
    const { member, room } = await setup();
    const status = await new Promise<string>((resolve) => {
      const channel = member.client.channel(`walkie:${room}`, { config: { private: true, broadcast: { self: false } } });
      channel.subscribe((s) => {
        if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) resolve(s);
      });
    });
    expect(status).not.toBe("SUBSCRIBED");
    const policies = await sql("select 1 from pg_policies where schemaname = 'realtime' and policyname like 'walkie_channel%'");
    expect(policies).toEqual([]);
  });
});
