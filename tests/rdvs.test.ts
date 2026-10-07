import { describe, expect, it } from "vitest";
import { call, callOk, createCrew, createUser, invokeAs, sql, type TestUser } from "./helpers";

interface RdvRow {
  id: string;
  host_id: string | null;
  host_handle: string | null;
  title: string;
  kind: string;
  area_name: string;
  status: string;
  crew_ids: string[];
  place: { name: string; lat: number; lng: number } | null;
  going: number;
  maybe: number;
  cant: number;
  my_answer: string | null;
  arrived: boolean;
}

const PLACE = { lat: 43.65, lng: -79.38 };
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

const create = (u: TestUser, crewIds: string[], over: Record<string, unknown> = {}) =>
  call<string>(u.client, "rdvs", "create_rdv", {
    p_title: "Sunday meet",
    p_kind: "meet",
    p_place_name: "Harbour lot",
    p_lat: PLACE.lat,
    p_lng: PLACE.lng,
    p_area_name: "Waterfront",
    p_starts_at: hoursFromNow(5),
    p_ends_at: null,
    p_note: null,
    p_crew_ids: crewIds,
    p_radius_m: 150,
    ...over,
  });

const createOk = async (u: TestUser, crewIds: string[], over: Record<string, unknown> = {}) => {
  const { data, error } = await create(u, crewIds, over);
  if (error) throw new Error(error);
  return data;
};

const list = (u: TestUser, crewIds: string[]) => callOk<RdvRow[]>(u.client, "rdvs", "list_rdvs", { p_crew_ids: crewIds });
const find = async (u: TestUser, crewIds: string[], id: string) => (await list(u, crewIds)).find((r) => r.id === id);
const rsvp = (u: TestUser, id: string, answer: string) => call(u.client, "rdvs", "set_rsvp", { p_rdv: id, p_answer: answer });

// Moves an RDV to a time relative to now, in minutes. end is null for the three hour default.
const move = (id: string, startMin: number, endMin: number | null = null) =>
  sql("update rdvs.rdvs set starts_at = now() + make_interval(mins => $2), ends_at = case when $3::int is null then null else now() + make_interval(mins => $3::int) end where id = $1", [id, startMin, endMin]);

const arrive = (u: TestUser, id: string, lat = PLACE.lat, lng = PLACE.lng, method?: string) =>
  invokeAs(u.client, "record_arrival", { rdv_id: id, position: { lat, lng }, ...(method ? { method } : {}) });

async function setup() {
  const owner = await createUser();
  const member = await createUser();
  const other = await createUser();
  const stranger = await createUser();
  const crew = await createCrew(owner);
  await callOk(member.client, "crews", "join_crew", { p_link_code: crew.link_code });
  await callOk(other.client, "crews", "join_crew", { p_link_code: crew.link_code });
  return { owner, member, other, stranger, crew };
}

describe("creating RDVs", () => {
  it("stores the RDV, its place and its crews, and makes the caller the host", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id], { p_title: "  Sunday meet ", p_note: "  Bring a chair " });
    const row = await find(member, [crew.id], id);
    expect(row).toMatchObject({ title: "Sunday meet", kind: "meet", host_id: member.id, status: "scheduled", crew_ids: [crew.id], place: { name: "Harbour lot", ...PLACE }, going: 0, my_answer: null });
    const [stored] = await sql<{ note: string; radius_m: number; ends_at: string | null }>("select note, radius_m, ends_at from rdvs.rdvs where id = $1", [id]);
    expect(stored).toMatchObject({ note: "Bring a chair", radius_m: 150, ends_at: null });
  });

  it("validates fields with stable codes", async () => {
    const { member, stranger, crew } = await setup();
    expect((await create(member, [crew.id], { p_title: "ab" })).error).toBe("rdv_title_invalid");
    expect((await create(member, [crew.id], { p_title: "x".repeat(61) })).error).toBe("rdv_title_invalid");
    expect((await create(member, [crew.id], { p_title: "x".repeat(60) })).error).toBeNull();
    expect((await create(member, [crew.id], { p_kind: "party" })).error).toBe("rdv_kind_invalid");
    expect((await create(member, [crew.id], { p_kind: "cruise" })).error).toBeNull();
    expect((await create(member, [crew.id], { p_kind: "private_event" })).error).toBeNull();
    expect((await create(member, [crew.id], { p_note: "n".repeat(281) })).error).toBe("rdv_note_invalid");
    expect((await create(member, [crew.id], { p_note: "n".repeat(280) })).error).toBeNull();
    expect((await create(member, [crew.id], { p_radius_m: 49 })).error).toBe("rdv_radius_invalid");
    expect((await create(member, [crew.id], { p_radius_m: 501 })).error).toBe("rdv_radius_invalid");
    expect((await create(member, [crew.id], { p_radius_m: 50 })).error).toBeNull();
    expect((await create(member, [crew.id], { p_radius_m: 500 })).error).toBeNull();
    expect((await create(member, [crew.id], { p_lat: 91 })).error).toBe("rdv_place_invalid");
    expect((await create(member, [crew.id], { p_place_name: "  " })).error).toBe("rdv_place_invalid");
    expect((await create(member, [crew.id], { p_starts_at: hoursFromNow(-1) })).error).toBe("rdv_in_past");
    expect((await create(member, [crew.id], { p_ends_at: hoursFromNow(4) })).error).toBe("rdv_end_invalid");
    expect((await create(member, [crew.id], { p_ends_at: hoursFromNow(6) })).error).toBeNull();
    expect((await create(member, [])).error).toBe("rdv_crew_required");
    expect((await create(stranger, [crew.id])).error).toBe("not_a_member");
    expect((await create(member, [crew.id, (await createCrew(stranger)).id])).error).toBe("not_a_member");
  });

  it("has no cap per member or crew", async () => {
    const { member, crew } = await setup();
    for (let i = 0; i < 12; i++) await createOk(member, [crew.id]);
    expect((await list(member, [crew.id])).length).toBeGreaterThanOrEqual(12);
  });

  it("does not allow direct writes to any table", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    const db = member.client.schema("rdvs");
    expect((await db.from("rdvs").insert({ host_id: member.id, title: "Direct", kind: "meet", area_name: "x", starts_at: hoursFromNow(2) })).error).not.toBeNull();
    expect((await db.from("rsvps").insert({ rdv_id: id, user_id: member.id, answer: "going" })).error).not.toBeNull();
    expect((await db.from("arrivals").insert({ rdv_id: id, user_id: member.id, method: "here" })).error).not.toBeNull();
    expect((await db.from("places").insert({ rdv_id: id, place_name: "x", lat: 1, lng: 1 })).error).not.toBeNull();
    expect((await db.from("crews").insert({ rdv_id: id, crew_id: crew.id })).error).not.toBeNull();
    await db.from("rdvs").update({ title: "Changed" }).eq("id", id);
    await db.from("rdvs").delete().eq("id", id);
    const [row] = await sql<{ title: string }>("select title from rdvs.rdvs where id = $1", [id]);
    expect(row?.title).toBe("Sunday meet");
  });
});

describe("who can see an RDV", () => {
  it("shows it only to members of its crews", async () => {
    const { member, stranger, owner, crew } = await setup();
    const otherCrew = await createCrew(stranger);
    const id = await createOk(member, [crew.id]);
    expect((await list(owner, [crew.id])).map((r) => r.id)).toContain(id);
    expect(await list(stranger, [crew.id])).toEqual([]);
    expect(await list(stranger, [otherCrew.id])).toEqual([]);
    for (const table of ["rdvs", "places", "crews"]) {
      const { data } = await stranger.client.schema("rdvs").from(table).select("*");
      expect(data).toEqual([]);
    }
    expect((await call(stranger.client, "rdvs", "list_rsvps", { p_rdv: id })).error).toBe("rdv_not_found");
    expect((await rsvp(stranger, id, "going")).error).toBe("rdv_not_found");
  });

  it("lists only the crews asked for and a multi-crew RDV for each of them", async () => {
    const { member, owner, crew } = await setup();
    const second = await createCrew(owner);
    await callOk(member.client, "crews", "join_crew", { p_link_code: second.link_code });
    const both = await createOk(member, [crew.id, second.id]);
    const onlySecond = await createOk(member, [second.id]);
    expect((await list(member, [crew.id])).map((r) => r.id)).toEqual([both]);
    expect((await list(member, [second.id])).map((r) => r.id).sort()).toEqual([both, onlySecond].sort());
    expect((await find(member, [crew.id], both))!.crew_ids.sort()).toEqual([crew.id, second.id].sort());
  });

  it("stops showing it to a member who leaves, while their own answer and arrival stay readable to them", async () => {
    const { member, other, crew } = await setup();
    const id = await createOk(other, [crew.id]);
    await rsvp(member, id, "going");
    await move(id, -10);
    expect((await arrive(member, id)).body).toMatchObject({ recorded: true });
    await callOk(member.client, "crews", "leave_crew", { p_crew: crew.id });
    expect(await list(member, [crew.id])).toEqual([]);
    expect((await member.client.schema("rdvs").from("rdvs").select("id")).data).toEqual([]);
    const own = await member.client.schema("rdvs").from("rsvps").select("rdv_id").eq("user_id", member.id);
    expect(own.data).toHaveLength(1);
    const arrivals = await member.client.schema("rdvs").from("arrivals").select("rdv_id, method").eq("user_id", member.id);
    expect(arrivals.data).toEqual([{ rdv_id: id, method: "here" }]);
    const mine = await sql("select 1 from rdvs.arrivals where user_id = $1", [member.id]);
    expect(mine).toHaveLength(1);
  });

  it("keeps a left member's arrival visible to the crew and drops their answer from the counts", async () => {
    const { member, other, owner, crew } = await setup();
    const id = await createOk(owner, [crew.id]);
    await rsvp(member, id, "going");
    await rsvp(other, id, "maybe");
    await move(id, -10);
    await arrive(member, id);
    expect(await find(owner, [crew.id], id)).toMatchObject({ going: 1, maybe: 1 });
    await callOk(member.client, "crews", "leave_crew", { p_crew: crew.id });
    expect(await find(owner, [crew.id], id)).toMatchObject({ going: 0, maybe: 1 });
    const visible = await owner.client.schema("rdvs").from("arrivals").select("user_id").eq("rdv_id", id);
    expect(visible.data).toEqual([{ user_id: member.id }]);
    const rsvps = await owner.client.schema("rdvs").from("rsvps").select("user_id").eq("rdv_id", id);
    expect(rsvps.data).toEqual([{ user_id: other.id }]);
  });

  it("keeps arrivals away from people outside the crews", async () => {
    const { member, stranger, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -10);
    await arrive(member, id);
    expect((await stranger.client.schema("rdvs").from("arrivals").select("*")).data).toEqual([]);
    expect((await stranger.client.schema("rdvs").from("rsvps").select("*")).data).toEqual([]);
  });
});

describe("private events", () => {
  it("withholds the place until the member answers going or maybe", async () => {
    const { member, other, owner, crew } = await setup();
    const id = await createOk(owner, [crew.id], { p_kind: "private_event", p_place_name: "Garage 12", p_area_name: "Etobicoke" });

    const before = await find(member, [crew.id], id);
    expect(before).toMatchObject({ kind: "private_event", area_name: "Etobicoke", place: null });
    expect(JSON.stringify(before)).not.toContain("Garage 12");
    expect((await member.client.schema("rdvs").from("places").select("*")).data).toEqual([]);

    await rsvp(member, id, "maybe");
    expect((await find(member, [crew.id], id))!.place).toMatchObject({ name: "Garage 12", ...PLACE });
    expect((await member.client.schema("rdvs").from("places").select("place_name")).data).toEqual([{ place_name: "Garage 12" }]);

    await rsvp(member, id, "cant");
    expect((await find(member, [crew.id], id))!.place).toBeNull();
    expect((await member.client.schema("rdvs").from("places").select("*")).data).toEqual([]);

    expect((await find(other, [crew.id], id))!.place).toBeNull();
    await rsvp(other, id, "going");
    expect((await find(other, [crew.id], id))!.place).not.toBeNull();
    expect((await find(owner, [crew.id], id))!.place).not.toBeNull();
  });

  it("shows a meet's place to every member", async () => {
    const { member, crew, owner } = await setup();
    const id = await createOk(owner, [crew.id]);
    expect((await find(member, [crew.id], id))!.place).not.toBeNull();
  });

  it("does not take an arrival from a member who cannot see the place", async () => {
    const { member, owner, crew } = await setup();
    const id = await createOk(owner, [crew.id], { p_kind: "private_event" });
    await move(id, -10);
    const res = await arrive(member, id);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "rdv_not_found" });
    await rsvp(member, id, "going");
    expect((await arrive(member, id)).body).toMatchObject({ recorded: true });
  });
});

describe("editing and cancelling", () => {
  it("lets only the host edit", async () => {
    const { member, owner, stranger, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    const edit = (u: TestUser, over: Record<string, unknown> = {}) =>
      call(u.client, "rdvs", "update_rdv", {
        p_rdv: id, p_title: "Moved meet", p_kind: "meet", p_place_name: "New lot", p_lat: 43.7, p_lng: -79.4, p_area_name: "North",
        p_starts_at: hoursFromNow(6), p_ends_at: hoursFromNow(8), p_note: "Updated", p_crew_ids: [crew.id], p_radius_m: 200, ...over,
      });
    expect((await edit(owner)).error).toBe("not_host");
    expect((await edit(stranger)).error).toBe("rdv_not_found");
    expect((await edit(member, { p_title: "ab" })).error).toBe("rdv_title_invalid");
    expect((await edit(member, { p_starts_at: hoursFromNow(-2), p_ends_at: hoursFromNow(8) })).error).toBe("rdv_in_past");
    expect((await edit(member)).error).toBeNull();
    expect(await find(member, [crew.id], id)).toMatchObject({ title: "Moved meet", area_name: "North", place: { name: "New lot", lat: 43.7, lng: -79.4 } });
    const [row] = await sql<{ radius_m: number; note: string }>("select radius_m, note from rdvs.rdvs where id = $1", [id]);
    expect(row).toEqual({ radius_m: 200, note: "Updated" });
  });

  it("keeps arrivals and answers when the RDV is edited", async () => {
    const { member, owner, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await rsvp(owner, id, "going");
    await move(id, -10);
    await arrive(owner, id);
    const [stored] = await sql<{ starts_at: Date }>("select starts_at from rdvs.rdvs where id = $1", [id]);
    const starts_at = stored!.starts_at;
    const edit = await call(member.client, "rdvs", "update_rdv", {
      p_rdv: id, p_title: "Late meet", p_kind: "meet", p_place_name: "Harbour lot", p_lat: PLACE.lat, p_lng: PLACE.lng, p_area_name: "Waterfront",
      p_starts_at: starts_at.toISOString(), p_ends_at: hoursFromNow(1), p_note: null, p_crew_ids: [crew.id], p_radius_m: 150,
    });
    expect(edit.error).toBeNull();
    expect(await sql("select 1 from rdvs.arrivals where rdv_id = $1 and user_id = $2", [id, owner.id])).toHaveLength(1);
    expect(await find(member, [crew.id], id)).toMatchObject({ going: 1 });
  });

  it("lets the host or a crew owner cancel, and nobody else", async () => {
    const { member, owner, other, stranger, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    expect((await call(other.client, "rdvs", "cancel_rdv", { p_rdv: id })).error).toBe("not_owner");
    expect((await call(stranger.client, "rdvs", "cancel_rdv", { p_rdv: id })).error).toBe("rdv_not_found");
    expect((await find(member, [crew.id], id))!.status).toBe("scheduled");
    expect((await call(owner.client, "rdvs", "cancel_rdv", { p_rdv: id })).error).toBeNull();
    expect((await find(member, [crew.id], id))!.status).toBe("cancelled");

    const mine = await createOk(member, [crew.id]);
    expect((await call(member.client, "rdvs", "cancel_rdv", { p_rdv: mine })).error).toBeNull();
    expect((await find(member, [crew.id], mine))!.status).toBe("cancelled");
  });

  it("does not let an owner of an unrelated crew cancel", async () => {
    const { member, stranger, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await createCrew(stranger);
    expect((await call(stranger.client, "rdvs", "cancel_rdv", { p_rdv: id })).error).toBe("rdv_not_found");
  });

  it("keeps a cancelled RDV listed until its window ends, then drops it", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await callOk(member.client, "rdvs", "cancel_rdv", { p_rdv: id });
    expect(await find(member, [crew.id], id)).toMatchObject({ status: "cancelled" });
    await move(id, -300);
    expect(await find(member, [crew.id], id)).toBeUndefined();
  });

  it("rejects cancelling or editing an RDV that has ended", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -300);
    expect((await call(member.client, "rdvs", "cancel_rdv", { p_rdv: id })).error).toBe("rdv_closed");
  });

  it("reports an unknown RDV as not found", async () => {
    const { member } = await setup();
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await call(member.client, "rdvs", "cancel_rdv", { p_rdv: missing })).error).toBe("rdv_not_found");
    expect((await rsvp(member, missing, "going")).error).toBe("rdv_not_found");
  });
});

describe("listing", () => {
  it("orders soonest first and shows recent past RDVs for two weeks", async () => {
    const { member, crew } = await setup();
    const later = await createOk(member, [crew.id], { p_starts_at: hoursFromNow(30) });
    const sooner = await createOk(member, [crew.id], { p_starts_at: hoursFromNow(10) });
    const recent = await createOk(member, [crew.id]);
    const old = await createOk(member, [crew.id]);
    await move(recent, -60 * 24 * 3);
    await move(old, -60 * 24 * 20);
    const ids = (await list(member, [crew.id])).map((r) => r.id);
    expect(ids).toEqual([recent, sooner, later]);
    expect(ids).not.toContain(old);
  });

  it("returns the caller's answer and arrival with counts", async () => {
    const { member, other, owner, crew } = await setup();
    const id = await createOk(owner, [crew.id]);
    await rsvp(member, id, "going");
    await rsvp(other, id, "cant");
    expect(await find(member, [crew.id], id)).toMatchObject({ going: 1, maybe: 0, cant: 1, my_answer: "going", arrived: false });
    expect(await find(owner, [crew.id], id)).toMatchObject({ my_answer: null });
    const people = await callOk<{ handle: string; answer: string; arrived: boolean }[]>(owner.client, "rdvs", "list_rsvps", { p_rdv: id });
    expect(people.map((p) => [p.handle, p.answer])).toEqual([[member.handle, "going"], [other.handle, "cant"]]);
  });
});

describe("RSVP", () => {
  it("changes until the RDV ends and then closes", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    expect((await rsvp(member, id, "going")).error).toBeNull();
    expect((await rsvp(member, id, "maybe")).error).toBeNull();
    expect((await find(member, [crew.id], id))!.my_answer).toBe("maybe");
    expect((await rsvp(member, id, "later")).error).toBe("rdv_answer_invalid");

    await move(id, -170);
    expect((await rsvp(member, id, "cant")).error).toBeNull();
    await move(id, -190);
    expect((await rsvp(member, id, "going")).error).toBe("rdv_closed");

    await move(id, -120, 60);
    expect((await rsvp(member, id, "going")).error).toBeNull();
    await move(id, -120, -1);
    expect((await rsvp(member, id, "maybe")).error).toBe("rdv_closed");
    expect((await find(member, [crew.id], id))!.my_answer).toBe("going");
  });

  it("does not accept an answer on a cancelled RDV", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await callOk(member.client, "rdvs", "cancel_rdv", { p_rdv: id });
    expect((await rsvp(member, id, "going")).error).toBe("rdv_closed");
  });
});

describe("record_arrival", () => {
  it("requires a signed-in caller", async () => {
    const res = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:54321"}/functions/v1/record_arrival`, { method: "POST" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("records an arrival inside the radius and window with the method", async () => {
    const { member, crew, other } = await setup();
    const id = await createOk(member, [crew.id], { p_radius_m: 100 });
    await move(id, -10);
    const near = await arrive(member, id, PLACE.lat + 0.0005, PLACE.lng);
    expect(near).toMatchObject({ status: 200, body: { recorded: true, already: false } });
    const live = await arrive(other, id, PLACE.lat, PLACE.lng, "live");
    expect(live.body).toMatchObject({ recorded: true });
    const rows = await sql<{ user_id: string; method: string }>("select user_id, method from rdvs.arrivals where rdv_id = $1 order by method", [id]);
    expect(rows).toEqual([{ user_id: other.id, method: "live" }, { user_id: member.id, method: "here" }].sort((a, b) => a.method.localeCompare(b.method)));
    expect((await find(member, [crew.id], id))!.arrived).toBe(true);
  });

  it("rejects a reading outside the radius and stores nothing", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id], { p_radius_m: 100 });
    await move(id, -10);
    const far = await arrive(member, id, PLACE.lat + 0.002, PLACE.lng);
    expect(far).toMatchObject({ status: 409, body: { error: "outside_radius" } });
    expect(await sql("select 1 from rdvs.arrivals where rdv_id = $1", [id])).toHaveLength(0);
  });

  it("uses the RDV's own radius", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id], { p_radius_m: 500 });
    await move(id, -10);
    expect((await arrive(member, id, PLACE.lat + 0.0035, PLACE.lng)).body).toMatchObject({ recorded: true });
    const tight = await createOk(member, [crew.id], { p_radius_m: 50 });
    await move(tight, -10);
    expect((await arrive(member, tight, PLACE.lat + 0.0035, PLACE.lng)).body).toEqual({ error: "outside_radius" });
    expect((await arrive(member, tight, PLACE.lat + 0.0003, PLACE.lng)).body).toMatchObject({ recorded: true });
  });

  it("accepts only inside the window from one hour before the start until the end", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, 90);
    expect(await arrive(member, id)).toMatchObject({ status: 409, body: { error: "outside_window" } });
    await move(id, 50);
    expect((await arrive(member, id)).body).toMatchObject({ recorded: true });

    const ended = await createOk(member, [crew.id]);
    await move(ended, -200);
    expect((await arrive(member, ended)).body).toEqual({ error: "outside_window" });

    const withEnd = await createOk(member, [crew.id]);
    await move(withEnd, -120, -5);
    expect((await arrive(member, withEnd)).body).toEqual({ error: "outside_window" });
    await move(withEnd, -120, 5);
    expect((await arrive(member, withEnd)).body).toMatchObject({ recorded: true });
  });

  it("is idempotent per member per RDV", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -10);
    expect((await arrive(member, id)).body).toEqual({ recorded: true, already: false });
    const [first] = await sql<{ arrived_at: string }>("select arrived_at from rdvs.arrivals where rdv_id = $1", [id]);
    expect((await arrive(member, id, PLACE.lat, PLACE.lng, "live")).body).toEqual({ recorded: true, already: true });
    expect((await arrive(member, id, 10, 10)).body).toEqual({ recorded: true, already: true });
    const rows = await sql<{ arrived_at: string; method: string }>("select arrived_at, method from rdvs.arrivals where rdv_id = $1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ arrived_at: first!.arrived_at, method: "here" });
  });

  it("refuses a cancelled RDV, a stranger, a bad request and an unknown RDV", async () => {
    const { member, stranger, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -10);
    expect((await arrive(stranger, id)).body).toEqual({ error: "rdv_not_found" });
    expect((await invokeAs(member.client, "record_arrival", { rdv_id: id })).body).toEqual({ error: "invalid_request" });
    expect((await invokeAs(member.client, "record_arrival", { rdv_id: id, position: { lat: 200, lng: 0 } })).body).toEqual({ error: "invalid_request" });
    expect((await invokeAs(member.client, "record_arrival", { rdv_id: id, position: { lat: "1", lng: 0 } })).body).toEqual({ error: "invalid_request" });
    expect((await invokeAs(member.client, "record_arrival", { rdv_id: "not-an-id", position: PLACE })).body).toEqual({ error: "invalid_request" });
    expect((await invokeAs(member.client, "record_arrival", { rdv_id: id, position: PLACE, method: "gps" })).body).toEqual({ error: "invalid_request" });
    expect((await arrive(member, "00000000-0000-4000-8000-000000000000")).body).toEqual({ error: "rdv_not_found" });
    await callOk(member.client, "rdvs", "cancel_rdv", { p_rdv: id });
    expect((await arrive(member, id)).body).toEqual({ error: "rdv_closed" });
    expect(await sql("select 1 from rdvs.arrivals where rdv_id = $1", [id])).toHaveLength(0);
  });

  it("rate limits per account", async () => {
    const { member, other, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -10);
    await sql("insert into private.rate_limits (key, window_start, count) values ($1, now(), 30)", [`record_arrival:${member.id}`]);
    const limited = await arrive(member, id);
    expect(limited).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect((await arrive(other, id)).body).toMatchObject({ recorded: true });
  });

  it("does not let an app user call the service functions", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    expect((await call(member.client, "rdvs", "arrival_target", { p_user: member.id, p_rdv: id })).error).not.toBeNull();
    expect((await call(member.client, "rdvs", "store_arrival", { p_user: member.id, p_rdv: id, p_method: "here" })).error).not.toBeNull();
  });

  it("never stores the position", async () => {
    const { member, crew } = await setup();
    const id = await createOk(member, [crew.id], { p_radius_m: 500 });
    await move(id, -10);
    const lat = PLACE.lat + 0.0012345;
    const lng = PLACE.lng + 0.0012345;
    expect((await arrive(member, id, lat, lng)).body).toMatchObject({ recorded: true });
    const columns = await sql<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'rdvs' and table_name = 'arrivals' order by ordinal_position",
    );
    expect(columns.map((c) => c.column_name)).toEqual(["rdv_id", "user_id", "arrived_at", "method"]);
    const all = await sql<{ n: string }>(
      "select (select count(*) from rdvs.arrivals a where row_to_json(a)::text like '%0012345%') + (select count(*) from rdvs.rsvps a where row_to_json(a)::text like '%0012345%') + (select count(*) from rdvs.rdvs a where row_to_json(a)::text like '%0012345%') + (select count(*) from rdvs.places a where row_to_json(a)::text like '%0012345%') as n",
    );
    expect(Number(all[0]!.n)).toBe(0);
  });
});

describe("account deletion", () => {
  it("cancels a hosted RDV that has not ended, clears the host, removes the person's data and keeps others' arrivals", async () => {
    const { member, owner, other, crew } = await setup();
    const hosted = await createOk(member, [crew.id]);
    const ended = await createOk(member, [crew.id]);
    const mine = await createOk(owner, [crew.id]);
    await move(ended, -300);
    await move(hosted, -10);
    await move(mine, -10);
    await rsvp(member, mine, "going");
    await arrive(member, mine);
    await rsvp(other, hosted, "going");
    await arrive(other, hosted);
    await arrive(member, hosted);

    expect((await invokeAs(member.client, "delete-account")).body.ok).toBe(true);

    const rows = await sql<{ id: string; status: string; host_id: string | null }>("select id, status, host_id from rdvs.rdvs where id = any($1) order by id", [[hosted, ended]]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === hosted)).toMatchObject({ status: "cancelled", host_id: null });
    expect(rows.find((r) => r.id === ended)).toMatchObject({ status: "scheduled", host_id: null });
    expect(await sql("select 1 from rdvs.rsvps where user_id = $1", [member.id])).toHaveLength(0);
    expect(await sql("select 1 from rdvs.arrivals where user_id = $1", [member.id])).toHaveLength(0);
    expect(await sql("select 1 from rdvs.arrivals where user_id = $1 and rdv_id = $2", [other.id, hosted])).toHaveLength(1);

    const seen = await find(other, [crew.id], hosted);
    expect(seen).toMatchObject({ status: "cancelled", host_id: null, host_handle: null, arrived: true, going: 1 });
    expect((await find(owner, [crew.id], mine))!.going).toBe(0);
  });

  it("keeps an ended RDV and the arrivals at it after the host is deleted", async () => {
    const { member, other, crew } = await setup();
    const id = await createOk(member, [crew.id]);
    await move(id, -10);
    await arrive(other, id);
    await move(id, -300);
    await invokeAs(member.client, "delete-account");
    const kept = await find(other, [crew.id], id);
    expect(kept).toMatchObject({ status: "scheduled", host_id: null, arrived: true });
  });
});
