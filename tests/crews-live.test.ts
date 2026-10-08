import { describe, expect, it } from "vitest";
import { admin, call, callOk, createCrew, createUser, sql } from "./helpers";

interface CrewRow {
  id: string; name: string; role: string; link_code: string | null; selected: boolean;
  members: { user_id: string; handle: string; role: string; live: boolean }[];
}

describe("crews", () => {
  it("shares a chosen car with crew members, rejects unknown cars, and hides it from strangers", async () => {
    const owner = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const crew = await createCrew(owner, "Garage");
    await callOk(member.client, "crews", "join_crew", { p_link_code: crew.link_code });
    expect((await call(member.client, "accounts", "update_profile", { p_car_icon: "hyper" })).error).toBeNull();
    expect((await call(member.client, "accounts", "update_profile", { p_car_icon: "tractor" })).error).toBe("icon_invalid");
    const view = await callOk<{ members: { handle: string; car_icon: string }[] }[]>(owner.client, "crews", "list_my_crews");
    expect(view[0]!.members.find((m) => m.handle === member.handle)!.car_icon).toBe("hyper");
    expect(view[0]!.members.find((m) => m.handle === owner.handle)!.car_icon).toBe("gt");
    const peek = await stranger.client.schema("accounts").from("profiles").select("car_icon").eq("handle", member.handle);
    expect(peek.data ?? []).toHaveLength(0);
  });

  it("creates, joins by link, lists, and selects", async () => {
    const owner = await createUser();
    const member = await createUser();
    const crew = await createCrew(owner, "Night Cruisers");
    expect(crew.link_code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);

    await callOk(member.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const mine = await callOk<CrewRow[]>(member.client, "crews", "list_my_crews");
    expect(mine.length).toBe(1);
    expect(mine[0]!.role).toBe("member");
    expect(mine[0]!.link_code).toBeNull();
    expect(mine[0]!.members.map((m) => m.handle).sort()).toEqual([owner.handle, member.handle].sort());

    const ownerView = await callOk<CrewRow[]>(owner.client, "crews", "list_my_crews");
    expect(ownerView[0]!.link_code).toBe(crew.link_code);

    await callOk(member.client, "crews", "set_selected_crews", { p_crew_ids: [] });
    expect((await callOk<CrewRow[]>(member.client, "crews", "list_my_crews"))[0]!.selected).toBe(false);
    await callOk(member.client, "crews", "set_selected_crews", { p_crew_ids: [crew.id] });
    expect((await callOk<CrewRow[]>(member.client, "crews", "list_my_crews"))[0]!.selected).toBe(true);
  });

  it("validates names and links", async () => {
    const u = await createUser();
    expect((await call(u.client, "crews", "create_crew", { p_name: "ab" })).error).toBe("crew_name_invalid");
    expect((await call(u.client, "crews", "create_crew", { p_name: "x".repeat(31) })).error).toBe("crew_name_invalid");
    expect((await call(u.client, "crews", "join_crew", { p_link_code: "BADLINK" })).error).toBe("invalid_crew_link");
  });

  it("owner tools: remove, transfer, regenerate link, delete", async () => {
    const owner = await createUser();
    const m1 = await createUser();
    const m2 = await createUser();
    const crew = await createCrew(owner);
    await callOk(m1.client, "crews", "join_crew", { p_link_code: crew.link_code });
    await callOk(m2.client, "crews", "join_crew", { p_link_code: crew.link_code });

    expect((await call(m1.client, "crews", "remove_member", { p_crew: crew.id, p_user: m2.id })).error).toBe("not_moderator");
    expect((await call(m1.client, "crews", "regenerate_crew_link", { p_crew: crew.id })).error).toBe("not_owner");
    expect((await call(owner.client, "crews", "leave_crew", { p_crew: crew.id })).error).toBe("owner_must_transfer");

    const newCode = await callOk<string>(owner.client, "crews", "regenerate_crew_link", { p_crew: crew.id });
    expect(newCode).not.toBe(crew.link_code);
    const late = await createUser();
    expect((await call(late.client, "crews", "join_crew", { p_link_code: crew.link_code })).error).toBe("invalid_crew_link");

    await callOk(owner.client, "crews", "remove_member", { p_crew: crew.id, p_user: m2.id });
    expect((await callOk<CrewRow[]>(m2.client, "crews", "list_my_crews")).length).toBe(0);

    await callOk(owner.client, "crews", "transfer_ownership", { p_crew: crew.id, p_user: m1.id });
    expect((await callOk<CrewRow[]>(m1.client, "crews", "list_my_crews"))[0]!.role).toBe("owner");
    await callOk(owner.client, "crews", "leave_crew", { p_crew: crew.id });

    await callOk(m1.client, "crews", "delete_crew", { p_crew: crew.id });
    expect((await callOk<CrewRow[]>(m1.client, "crews", "list_my_crews")).length).toBe(0);
    const rows = await sql<{ status: string; link_code: string | null }>("select status, link_code from crews.crews where id = $1", [crew.id]);
    expect(rows[0]).toEqual({ status: "dissolved", link_code: null });
  });
});

describe("live sessions and leaderboard", () => {
  it("shows live status, ranks top speed, and ties share a rank", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const crew = await createCrew(a);
    for (const u of [b, c]) await callOk(u.client, "crews", "join_crew", { p_link_code: crew.link_code });

    const sessions: Record<string, string> = {};
    for (const [u, speed] of [[a, 180], [b, 150], [c, 150]] as const) {
      const sid = await callOk<string>(u.client, "live", "start_session", { p_crew_ids: [crew.id], p_platform: "test" });
      sessions[u.id] = sid;
      await callOk(u.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: speed, p_distance_m: 1000 });
    }
    const view = await callOk<CrewRow[]>(a.client, "crews", "list_my_crews");
    expect(view[0]!.members.every((m) => m.live)).toBe(true);

    const board = await callOk<{ rank: number; handle: string; top_speed_kmh: number }[]>(a.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id });
    expect(board.map((r) => r.rank)).toEqual([1, 2, 2]);
    expect(board[0]).toMatchObject({ handle: a.handle, top_speed_kmh: 180 });

    // Max only goes up within a week segment.
    await callOk(a.client, "live", "checkpoint_session", { p_session: sessions[a.id], p_max_speed_kmh: 120, p_distance_m: 2000 });
    const again = await callOk<{ top_speed_kmh: number }[]>(a.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id });
    expect(again[0]!.top_speed_kmh).toBe(180);

    await callOk(a.client, "live", "end_session", { p_session: sessions[a.id] });
    expect((await call(a.client, "live", "checkpoint_session", { p_session: sessions[a.id], p_max_speed_kmh: 1 })).error).toBe("session_not_found");
  });

  it("only counts sessions shared with that crew", async () => {
    const a = await createUser();
    const b = await createUser();
    const crewA = await createCrew(a, "Crew Alpha");
    const crewB = await createCrew(b, "Crew Bravo");
    // a is in both crews but shares the session only with Alpha.
    await callOk(a.client, "crews", "join_crew", { p_link_code: crewB.link_code });
    const sid = await callOk<string>(a.client, "live", "start_session", { p_crew_ids: [crewA.id] });
    await callOk(a.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 200, p_distance_m: 10 });

    const alpha = await callOk<unknown[]>(a.client, "leaderboard", "weekly_top_speed", { p_crew: crewA.id });
    const bravo = await callOk<unknown[]>(b.client, "leaderboard", "weekly_top_speed", { p_crew: crewB.id });
    expect(alpha.length).toBe(1);
    expect(bravo.length).toBe(0);
  });

  it("keeps each week separate and never carries a max across the boundary", async () => {
    const a = await createUser();
    const crew = await createCrew(a);
    const sid = await callOk<string>(a.client, "live", "start_session", { p_crew_ids: [crew.id] });
    const thisWeek = await callOk<string>(a.client, "live", "checkpoint_session", { p_session: sid, p_max_speed_kmh: 90, p_distance_m: 5 });
    // Seed a previous week's segment for the same session (as the app would have written it).
    await sql(
      `insert into live.segments (session_id, week_start, max_speed_kmh, max_speed_at, distance_m)
       values ($1, ($2::date - 7), 210, now() - interval '7 days', 100)`, [sid, thisWeek]);
    const current = await callOk<{ top_speed_kmh: number }[]>(a.client, "leaderboard", "weekly_top_speed", { p_crew: crew.id });
    expect(current[0]!.top_speed_kmh).toBe(90);
    const prev = await callOk<{ top_speed_kmh: number }[]>(a.client, "leaderboard", "weekly_top_speed", {
      p_crew: crew.id, p_week_start: new Date(new Date(thisWeek + "T00:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10),
    });
    expect(prev[0]!.top_speed_kmh).toBe(210);
  });

  it("ends stale sessions with the sweep and leaving a crew stops sharing with it", async () => {
    const a = await createUser();
    const b = await createUser();
    const crew = await createCrew(a);
    await callOk(b.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const sid = await callOk<string>(b.client, "live", "start_session", { p_crew_ids: [crew.id] });

    await sql("update live.sessions set last_seen_at = now() - interval '6 minutes' where id = $1", [sid]);
    const stale = await callOk<CrewRow[]>(a.client, "crews", "list_my_crews");
    expect(stale[0]!.members.find((m) => m.user_id === b.id)!.live).toBe(false);
    const swept = await callOk<number>(admin, "live", "sweep_stale");
    expect(swept).toBeGreaterThanOrEqual(1);
    const [row] = await sql<{ ended_at: string | null }>("select ended_at from live.sessions where id = $1", [sid]);
    expect(row!.ended_at).not.toBeNull();

    const sid2 = await callOk<string>(b.client, "live", "start_session", { p_crew_ids: [crew.id] });
    await callOk(b.client, "crews", "leave_crew", { p_crew: crew.id });
    const shared = await sql("select 1 from live.session_crews where session_id = $1", [sid2]);
    expect(shared.length).toBe(0);
  });

  it("refuses to start a session for a crew you are not in", async () => {
    const a = await createUser();
    const stranger = await createUser();
    const crew = await createCrew(a);
    expect((await call(stranger.client, "live", "start_session", { p_crew_ids: [crew.id] })).error).toBe("not_a_member");
  });
});
