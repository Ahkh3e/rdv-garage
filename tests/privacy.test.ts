import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ANON_KEY, API_URL, call, callOk, createCrew, createUser, signIn, sleep, sql, type TestUser } from "./helpers";

async function selectAs(u: TestUser, schema: string, table: string, columns = "*") {
  const { data, error } = await u.client.schema(schema).from(table).select(columns);
  return { rows: (data ?? []) as unknown as { id: string }[], error: error?.message ?? null };
}

describe("access policies", () => {
  it("lets members read crew data and keeps strangers out", async () => {
    const owner = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const crew = await createCrew(owner);
    await callOk(member.client, "crews", "join_crew", { p_link_code: crew.link_code });

    expect((await selectAs(member, "crews", "crews", "id,name")).rows.some((r: { id: string }) => r.id === crew.id)).toBe(true);
    expect((await selectAs(stranger, "crews", "crews", "id,name")).rows.some((r: { id: string }) => r.id === crew.id)).toBe(false);
    expect((await selectAs(stranger, "crews", "members")).rows.length).toBe(0);

    // Profiles: members see each other, strangers do not see them.
    const memberProfiles = (await selectAs(member, "accounts", "profiles", "id,handle")).rows.map((r: { id: string }) => r.id);
    expect(memberProfiles).toContain(owner.id);
    const strangerProfiles = (await selectAs(stranger, "accounts", "profiles", "id,handle")).rows.map((r: { id: string }) => r.id);
    expect(strangerProfiles).not.toContain(owner.id);
    expect(strangerProfiles).toContain(stranger.id);
  });

  it("hides segments from crews a session was not shared with", async () => {
    const a = await createUser();
    const b = await createUser();
    const crewA = await createCrew(a, "Alpha Crew");
    const crewB = await createCrew(b, "Bravo Crew");
    await callOk(a.client, "crews", "join_crew", { p_link_code: crewB.link_code });
    const sid = await callOk<string>(a.client, "live", "start_session", { p_crew_ids: [crewA.id] });
    await callOk(a.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 100, p_distance_m: 1 });

    expect((await selectAs(a, "live", "segments")).rows.length).toBe(1);
    expect((await selectAs(b, "live", "segments")).rows.length).toBe(0);
  });

  it("blocks writes and column reads that should be hidden", async () => {
    const u = await createUser();
    const crew = await createCrew(u);
    const forbidden = await u.client.schema("crews").from("crews").select("link_code");
    expect(forbidden.error).not.toBeNull();
    const writeProfile = await u.client.schema("accounts").from("profiles").update({ status: "active", handle: "hacked1" }).eq("id", u.id);
    expect(writeProfile.error).not.toBeNull();
    const writeMember = await u.client.schema("crews").from("members").insert({ crew_id: crew.id, user_id: u.id, role: "owner" });
    expect(writeMember.error).not.toBeNull();
    const emailLeak = await u.client.schema("accounts").from("profiles").select("email");
    expect(emailLeak.error).not.toBeNull();
  });

  it("denies everything to a suspended user", async () => {
    const owner = await createUser();
    const victim = await createUser();
    const crew = await createCrew(owner);
    await callOk(victim.client, "crews", "join_crew", { p_link_code: crew.link_code });
    await admin.schema("accounts").rpc("suspend_user", { p_user: victim.id });
    expect((await selectAs(victim, "crews", "crews", "id,name")).rows.length).toBe(0);
    expect((await call(victim.client, "crews", "list_my_crews")).error).toBe("suspended");
    expect((await call(victim.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id })).error).toBe("suspended");
  });

  it("keeps chat closed to anonymous callers and suspended users, and service-only functions out of reach", async () => {
    const owner = await createUser();
    const victim = await createUser();
    const crew = await createCrew(owner);
    await callOk(victim.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const room = (await selectAs(victim, "chat", "rooms")).rows[0]!.id;
    await callOk(victim.client, "chat", "send_message", { p_room: room, p_body: "hi" });
    const anonymous = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
    expect((await anonymous.schema("chat").from("messages").select("id")).error).not.toBeNull();
    expect((await anonymous.schema("chat").rpc("list_rooms")).error).not.toBeNull();
    for (const fn of ["close_finished_rdv_rooms", "expire_messages"]) {
      expect((await call(victim.client, "chat", fn)).error).not.toBeNull();
    }
    await admin.schema("accounts").rpc("suspend_user", { p_user: victim.id });
    expect((await selectAs(victim, "chat", "messages")).rows.length).toBe(0);
    expect((await call(victim.client, "chat", "list_rooms")).error).toBe("suspended");
    expect((await call(victim.client, "chat", "send_message", { p_room: room, p_body: "still?" })).error).toBe("suspended");
  });

  it("does not expose the private schema or service-only functions", async () => {
    const u = await createUser();
    expect((await call(u.client, "private", "setting", { p_key: "terms_version" })).error).not.toBeNull();
    expect((await call(u.client, "accounts", "create_profile", { p_id: u.id, p_handle: "x1234", p_invited_by: null, p_invite_id: null, p_terms_version: "v1" })).error).not.toBeNull();
    expect((await call(u.client, "accounts", "delete_account_data", { p_user: u.id })).error).not.toBeNull();
    expect((await call(u.client, "live", "sweep_stale")).error).not.toBeNull();
  });
});

describe("realtime channels", () => {
  async function channelFor(u: TestUser, crewId: string) {
    const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await u.client.auth.getSession();
    await client.auth.setSession({ access_token: data.session!.access_token, refresh_token: data.session!.refresh_token });
    client.realtime.setAuth(data.session!.access_token);
    const channel = client.channel(`crew:${crewId}`, { config: { private: true, broadcast: { self: false, ack: true } } });
    const status = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("TIMED_OUT"), 8000);
      channel.subscribe((s) => {
        if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(s)) { clearTimeout(timer); resolve(s); }
      });
    });
    return { client, channel, status };
  }

  it("delivers positions to crew members and refuses strangers and silent senders", async () => {
    const driver = await createUser();
    const friend = await createUser();
    const stranger = await createUser();
    const crew = await createCrew(driver);
    await callOk(friend.client, "crews", "join_crew", { p_link_code: crew.link_code });
    await callOk<string>(driver.client, "live", "start_session", { p_crew_ids: [crew.id] });

    const rx = await channelFor(friend, crew.id);
    expect(rx.status).toBe("SUBSCRIBED");
    const received: unknown[] = [];
    rx.channel.on("broadcast", { event: "pos" }, (msg) => received.push(msg.payload));

    const bad = await channelFor(stranger, crew.id);
    expect(bad.status).not.toBe("SUBSCRIBED");

    const tx = await channelFor(driver, crew.id);
    expect(tx.status).toBe("SUBSCRIBED");
    const ack = await tx.channel.send({ type: "broadcast", event: "pos", payload: { lat: 43.65, lng: -79.38, user_id: driver.id } });
    expect(ack).toBe("ok");
    await sleep(1500);
    expect(received.length).toBe(1);

    // A member with no live session cannot send.
    const silent = await channelFor(friend, crew.id);
    const silentAck = await silent.channel.send({ type: "broadcast", event: "pos", payload: { lat: 1, lng: 1 } });
    expect(silentAck).not.toBe("ok");

    for (const c of [rx, bad, tx, silent]) await c.client.removeAllChannels();
  });
});
