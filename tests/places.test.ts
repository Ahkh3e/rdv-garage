import { describe, expect, it } from "vitest";
import { admin, call, callOk, createCrew, createUser, invokeAs, sql, type TestUser } from "./helpers";

interface PinRow {
  id: string;
  dropper_handle: string;
  label: string;
  crew_ids: string[];
}

const drop = (u: TestUser, crewIds: string[], over: Record<string, unknown> = {}) =>
  call<string>(u.client, "places", "drop_pin", {
    p_label: "Meet spot",
    p_note: null,
    p_lat: 43.65,
    p_lng: -79.38,
    p_address: "1 Main St",
    p_crew_ids: crewIds,
    ...over,
  });

const dropOk = async (u: TestUser, crewIds: string[], over: Record<string, unknown> = {}) => {
  const { data, error } = await drop(u, crewIds, over);
  if (error) throw new Error(error);
  return data;
};

const list = (u: TestUser, crewIds: string[]) => callOk<PinRow[]>(u.client, "places", "list_pins", { p_crew_ids: crewIds });

async function visibleIds(u: TestUser) {
  const { data } = await u.client.schema("places").from("pins").select("id");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function setup() {
  const owner = await createUser();
  const member = await createUser();
  const stranger = await createUser();
  const crew = await createCrew(owner);
  await callOk(member.client, "crews", "join_crew", { p_link_code: crew.link_code });
  return { owner, member, stranger, crew };
}

describe("dropping pins", () => {
  it("stores a pin that expires 24 hours later", async () => {
    const { member, crew } = await setup();
    const id = await dropOk(member, [crew.id], { p_label: "  Cars and coffee ", p_note: "  Bring a chair " });
    const [row] = await sql<{ label: string; note: string; hours: number }>(
      "select label, note, extract(epoch from (expires_at - created_at)) / 3600 as hours from places.pins where id = $1",
      [id],
    );
    expect(row).toMatchObject({ label: "Cars and coffee", note: "Bring a chair" });
    expect(Number(row!.hours)).toBe(24);
  });

  it("validates label, note, place and crews with stable codes", async () => {
    const { member, stranger, crew } = await setup();
    expect((await drop(member, [crew.id], { p_label: "ab" })).error).toBe("pin_label_invalid");
    expect((await drop(member, [crew.id], { p_label: "x".repeat(41) })).error).toBe("pin_label_invalid");
    expect((await drop(member, [crew.id], { p_label: "   " })).error).toBe("pin_label_invalid");
    expect((await drop(member, [crew.id], { p_note: "n".repeat(141) })).error).toBe("pin_note_invalid");
    expect((await drop(member, [crew.id], { p_note: "n".repeat(140), p_label: "x".repeat(40) })).error).toBeNull();
    expect((await drop(member, [crew.id], { p_lat: 91 })).error).toBe("pin_place_invalid");
    expect((await drop(member, [crew.id], { p_lng: -181 })).error).toBe("pin_place_invalid");
    expect((await drop(member, [])).error).toBe("pin_crew_required");
    expect((await drop(stranger, [crew.id])).error).toBe("not_a_member");
    expect((await drop(member, [crew.id, (await createCrew(stranger)).id])).error).toBe("not_a_member");
  });

  it("does not allow direct writes", async () => {
    const { member, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    const insert = await member.client.schema("places").from("pins").insert({ dropper_id: member.id, label: "Direct", lat: 1, lng: 1 });
    expect(insert.error).not.toBeNull();
    await member.client.schema("places").from("pins").update({ label: "Changed" }).eq("id", id);
    await member.client.schema("places").from("pins").delete().eq("id", id);
    const [row] = await sql<{ label: string }>("select label from places.pins where id = $1", [id]);
    expect(row?.label).toBe("Meet spot");
    expect((await member.client.schema("places").from("pin_crews").insert({ pin_id: id, crew_id: crew.id })).error).not.toBeNull();
  });
});

describe("pin visibility", () => {
  it("shows a pin only to members of the crews it was dropped for", async () => {
    const { owner, member, stranger, crew } = await setup();
    const other = await createCrew(owner, "Other Crew");
    const id = await dropOk(member, [crew.id]);

    expect(await visibleIds(owner)).toContain(id);
    expect(await visibleIds(member)).toContain(id);
    expect(await visibleIds(stranger)).not.toContain(id);
    expect((await stranger.client.schema("places").from("pin_crews").select("pin_id")).data).toEqual([]);
    expect((await list(stranger, [crew.id])).length).toBe(0);

    const otherOnly = await dropOk(member, [crew.id], { p_label: "Crew only" });
    await callOk(member.client, "crews", "join_crew", { p_link_code: (await sql<{ link_code: string }>("select link_code from crews.crews where id = $1", [other.id]))[0]!.link_code });
    const second = await dropOk(member, [other.id], { p_label: "Other only" });
    expect((await list(owner, [crew.id, other.id])).map((p) => p.id).sort()).toEqual([id, otherOnly, second].sort());
    expect((await list(owner, [crew.id])).map((p) => p.id)).not.toContain(second);
  });

  it("limits list_pins to crews the caller is in, and reports only those crews", async () => {
    const { member, stranger, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    expect((await list(stranger, [crew.id])).length).toBe(0);
    const rows = await list(member, [crew.id]);
    expect(rows.find((p) => p.id === id)).toMatchObject({ dropper_handle: member.handle, crew_ids: [crew.id] });
  });

  it("hides expired pins and keeps them from lists", async () => {
    const { member, owner, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    await sql("update places.pins set expires_at = now() - interval '1 second' where id = $1", [id]);
    expect(await visibleIds(member)).not.toContain(id);
    expect((await list(owner, [crew.id])).map((p) => p.id)).not.toContain(id);
    expect((await call(owner.client, "places", "remove_pin", { p_pin: id })).error).toBe("pin_not_found");
  });

  it("stops showing a pin after its crew membership ends or the dropper leaves the app", async () => {
    const { member, owner, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    await callOk(member.client, "crews", "leave_crew", { p_crew: crew.id });
    expect(await visibleIds(member)).not.toContain(id);
    expect(await visibleIds(owner)).toContain(id);

    const rejoiner = await createUser();
    await callOk(rejoiner.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const mine = await dropOk(rejoiner, [crew.id], { p_label: "Gone soon" });
    expect(await visibleIds(owner)).toContain(mine);
    await admin.schema("accounts").rpc("suspend_user", { p_user: rejoiner.id });
    expect(await visibleIds(owner)).not.toContain(mine);
  });

  it("denies a suspended caller", async () => {
    const { member, crew } = await setup();
    await admin.schema("accounts").rpc("suspend_user", { p_user: member.id });
    expect((await drop(member, [crew.id])).error).toBe("suspended");
    expect((await call(member.client, "places", "list_pins", { p_crew_ids: [crew.id] })).error).toBe("suspended");
  });
});

describe("removing pins", () => {
  it("lets the dropper remove their own pin", async () => {
    const { member, owner, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    await callOk(member.client, "places", "remove_pin", { p_pin: id });
    expect(await visibleIds(owner)).not.toContain(id);
    expect(await sql("select 1 from places.pins where id = $1", [id])).toEqual([]);
  });

  it("lets a crew owner remove any pin in the crew", async () => {
    const { member, owner, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    await callOk(owner.client, "places", "remove_pin", { p_pin: id });
    expect(await visibleIds(member)).not.toContain(id);
  });

  it("refuses an ordinary member and hides the pin from a non-member", async () => {
    const { member, stranger, crew, owner } = await setup();
    const other = await createUser();
    await callOk(other.client, "crews", "join_crew", { p_link_code: crew.link_code });
    const id = await dropOk(owner, [crew.id]);
    expect((await call(member.client, "places", "remove_pin", { p_pin: id })).error).toBe("not_owner");
    expect((await call(stranger.client, "places", "remove_pin", { p_pin: id })).error).toBe("pin_not_found");
    expect((await call(other.client, "places", "remove_pin", { p_pin: "00000000-0000-0000-0000-000000000000" })).error).toBe("pin_not_found");
    expect(await visibleIds(owner)).toContain(id);
  });

  it("does not give an owner of an unrelated crew any power over the pin", async () => {
    const { member, crew } = await setup();
    const rival = await createUser();
    await createCrew(rival);
    const id = await dropOk(member, [crew.id]);
    expect((await call(rival.client, "places", "remove_pin", { p_pin: id })).error).toBe("pin_not_found");
  });
});

describe("hardening", () => {
  it("keeps the sweep away from signed-in callers", async () => {
    const { member } = await setup();
    expect((await call(member.client, "places", "sweep_expired")).error).not.toBeNull();
  });

  it("removes a deleted account's pins at once", async () => {
    const { member, owner, crew } = await setup();
    const mine = await dropOk(member, [crew.id]);
    const theirs = await dropOk(owner, [crew.id]);
    expect((await invokeAs(member.client, "delete-account")).body.ok).toBe(true);
    expect(await sql("select 1 from places.pins where id = $1", [mine])).toEqual([]);
    expect(await sql("select 1 from places.pin_crews where pin_id = $1", [mine])).toEqual([]);
    expect(await sql("select 1 from places.pins where id = $1", [theirs])).toHaveLength(1);
  });

  it("sweeps long-expired pins", async () => {
    const { member, crew } = await setup();
    const id = await dropOk(member, [crew.id]);
    await sql("update places.pins set expires_at = now() - interval '2 hours' where id = $1", [id]);
    await admin.schema("places").rpc("sweep_expired");
    expect(await sql("select 1 from places.pins where id = $1", [id])).toEqual([]);
  });
});
