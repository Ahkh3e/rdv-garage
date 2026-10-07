import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { AppError, DISCLAIMER_PLACES, ShellApp, type Place } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
const mockNotifications = require("expo-notifications");

const mockLocation = require("expo-location");

const H = 3600000;
const iso = (ms: number) => new Date(ms).toISOString();

const crewsRow = {
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [{ user_id: "user-1", handle: "tester", avatar_path: null, role: "owner", live: false }],
};

const rdvRow = (over: Record<string, unknown> = {}) => ({
  id: "r1", host_id: "user-2", host_handle: "ace", title: "Sunday meet", kind: "meet", area_name: "Waterfront",
  starts_at: iso(Date.now() + 5 * H), ends_at: null, end_at: iso(Date.now() + 8 * H), radius_m: 150, note: "Bring a chair", status: "scheduled",
  crew_ids: ["crew-1"], place: { name: "Harbour lot", lat: 43.65, lng: -79.38 }, going: 2, maybe: 1, cant: 0, my_answer: null, arrived: false, ...over,
});

const people = [
  { user_id: "user-2", handle: "ace", avatar_path: null, answer: "going", arrived: false },
  { user_id: "user-3", handle: "bolt", avatar_path: null, answer: "maybe", arrived: false },
];

function backend(rows: () => unknown[], extra: Record<string, (args: any) => unknown> = {}) {
  return makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crewsRow],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "places.list_pins": () => [],
    "rdvs.list_rdvs": rows,
    "rdvs.list_rsvps": () => people,
    "rdvs.set_rsvp": () => null,
    "rdvs.cancel_rdv": () => null,
    "rdvs.create_rdv": () => "new-rdv",
    "fn.record_arrival": () => ({ recorded: true, already: false }),
    ...extra,
  });
}

async function mount(b: ReturnType<typeof backend>) {
  const shell = makeShell(b, { rdvs: true });
  const directions = jest.fn(async () => undefined);
  shell.setHandoff({ openDirections: directions });
  await render(<ShellApp shell={shell} />);
  await screen.findByTestId("rdv-plans");
  await waitFor(() => expect(b.calls.some((c) => c.name === "rdvs.list_rdvs")).toBe(true));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { shell, directions };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
});

describe("RDV pins", () => {
  it("registers a pin of kind rdv in the crew colour for a scheduled RDV and none for a cancelled or private one without a place", async () => {
    const { shell } = await mount(backend(() => [
      rdvRow(),
      rdvRow({ id: "r2", status: "cancelled" }),
      rdvRow({ id: "r3", kind: "private_event", place: null }),
    ]));
    await waitFor(() => expect(shell.pins.store.get().map((p) => p.id)).toEqual(["rdvs:r1"]));
    expect(shell.pins.store.get()[0]).toMatchObject({ kind: "rdv", label: "Sunday meet", colorKey: 0, live: false });
  });

  it("marks the pin live while the RDV is happening and opens the detail when pressed", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ starts_at: iso(Date.now() - H), end_at: iso(Date.now() + 2 * H) })]));
    await waitFor(() => expect(shell.pins.store.get()[0]?.live).toBe(true));
    shell.pins.press("rdvs:r1");
    expect(await screen.findByText("Sunday meet")).toBeTruthy();
    expect(screen.getAllByText("LIVE").length).toBeGreaterThan(0);
  });
});

describe("Plans", () => {
  it("lists upcoming soonest first with a Past section, and opens the detail", async () => {
    await mount(backend(() => [
      rdvRow({ id: "later", title: "Later meet", starts_at: iso(Date.now() + 30 * H), end_at: iso(Date.now() + 33 * H) }),
      rdvRow({ id: "soon", title: "Soon meet", starts_at: iso(Date.now() + 2 * H), end_at: iso(Date.now() + 5 * H) }),
      rdvRow({ id: "old", title: "Old meet", starts_at: iso(Date.now() - 30 * H), end_at: iso(Date.now() - 27 * H) }),
    ]));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await screen.findByText("Upcoming");
    const rows = screen.getAllByTestId(/^rdv-row-/).map((r) => r.props.testID);
    expect(rows).toEqual(["rdv-row-soon", "rdv-row-later", "rdv-row-old"]);
    expect(screen.getByText("Past")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("rdv-row-soon"));
    expect(await screen.findByTestId("rdv-when")).toBeTruthy();
  });

  it("shows only RDVs of the selected crews", async () => {
    await mount(backend(() => [rdvRow(), rdvRow({ id: "elsewhere", title: "Other crew", crew_ids: ["crew-9"] })]));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await screen.findByText("Upcoming");
    expect(screen.queryByText("Other crew")).toBeNull();
    expect(screen.getByText("Sunday meet")).toBeTruthy();
  });
});

describe("RDV detail", () => {
  it("shows host, note, answers and counts, and hands Directions to the maps app", async () => {
    const { shell, directions } = await mount(backend(() => [rdvRow()]));
    shell.pins.press("rdvs:r1");
    expect(await screen.findByTestId("rdv-host")).toBeTruthy();
    expect(screen.getByText("Harbour lot")).toBeTruthy();
    expect(screen.getByText("Bring a chair")).toBeTruthy();
    expect(await screen.findByText("@bolt")).toBeTruthy();
    expect(screen.getByTestId("count-going").props.children).toBe("Going  2");
    expect(screen.queryByText(/ETA|min away|km away/i)).toBeNull();
    await fireEvent.press(screen.getByTestId("rdv-directions"));
    expect(directions).toHaveBeenCalledWith({ lat: 43.65, lng: -79.38, label: "Harbour lot" });
  });

  it("shows the straight-line distance from the device, worked out locally", async () => {
    const b = backend(() => [rdvRow()]);
    const { shell } = await mount(b);
    await act(async () => shell.mapBridge.setMe({ lat: 43.66, lng: -79.38 }));
    shell.pins.press("rdvs:r1");
    expect(await screen.findByText("Harbour lot  ·  1.1 km away")).toBeTruthy();
    expect(JSON.stringify([b.calls, b.invoked])).not.toContain("43.66");
  });

  it("shows no distance for a private event whose place is hidden", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ kind: "private_event", place: null, note: null })]));
    await act(async () => shell.mapBridge.setMe({ lat: 43.66, lng: -79.38 }));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await fireEvent.press(await screen.findByTestId("rdv-row-r1"));
    expect(await screen.findByText("Waterfront")).toBeTruthy();
    expect(screen.queryByText(/away/)).toBeNull();
  });

  it("sends the answer", async () => {
    const b = backend(() => [rdvRow()]);
    const { shell } = await mount(b);
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rsvp-maybe"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "rdvs.set_rsvp")?.args).toEqual({ p_rdv: "r1", p_answer: "maybe" }));
  });

  it("closes the answers when the RDV has ended", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ starts_at: iso(Date.now() - 5 * H), end_at: iso(Date.now() - 2 * H), my_answer: "going" })]));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await fireEvent.press(await screen.findByTestId("rdv-row-r1"));
    expect(await screen.findByText(/Answers are closed/)).toBeTruthy();
    expect(screen.queryByTestId("rsvp-going")).toBeNull();
    expect(screen.queryByTestId("rdv-here")).toBeNull();
    expect(shell.pins.store.get()).toEqual([]);
  });

  it("hides the place of a private event until the member answers, with no Directions", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ kind: "private_event", place: null, note: null })]));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await fireEvent.press(await screen.findByTestId("rdv-row-r1"));
    expect(await screen.findByText("Waterfront")).toBeTruthy();
    expect(screen.getByText(/exact place is shown to people who answer Going or Maybe/)).toBeTruthy();
    expect(screen.queryByText("Harbour lot")).toBeNull();
    expect(screen.queryByTestId("rdv-directions")).toBeNull();
    expect(shell.pins.store.get()).toEqual([]);
  });

  it("shows a cancelled RDV marked cancelled with no pin or answers", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ status: "cancelled" })]));
    await fireEvent.press(screen.getByTestId("rdv-plans"));
    await fireEvent.press(await screen.findByTestId("rdv-row-r1"));
    expect(await screen.findByText("This RDV was cancelled.")).toBeTruthy();
    expect(screen.queryByTestId("rsvp-going")).toBeNull();
    expect(shell.pins.store.get()).toEqual([]);
  });

  it("lets a crew owner cancel after confirming", async () => {
    const b = backend(() => [rdvRow()]);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { shell } = await mount(b);
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rdv-cancel"));
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => buttons.find((x) => x.text === "Cancel RDV")!.onPress!());
    await waitFor(() => expect(b.calls.some((c) => c.name === "rdvs.cancel_rdv" && (c.args as any).p_rdv === "r1")).toBe(true));
  });

  it("offers Edit only to the host", async () => {
    const { shell } = await mount(backend(() => [rdvRow(), rdvRow({ id: "mine", host_id: "user-1", host_handle: "tester" })]));
    shell.pins.press("rdvs:r1");
    await screen.findByTestId("rdv-host");
    expect(screen.queryByTestId("rdv-edit")).toBeNull();
    shell.pins.press("rdvs:mine");
    expect(await screen.findByTestId("rdv-edit")).toBeTruthy();
  });
});

describe("I'm here", () => {
  const open = (over: Record<string, unknown> = {}) => rdvRow({ ...over, starts_at: iso(Date.now() - 10 * 60000), end_at: iso(Date.now() + 2 * H) });

  it("takes one reading, records arrival, and only offers to go live", async () => {
    const b = backend(() => [open()]);
    const { shell } = await mount(b);
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rdv-here"));
    await waitFor(() => expect(b.invoked).toContainEqual({ name: "record_arrival", body: { rdv_id: "r1", position: { lat: 43.65, lng: -79.38 }, method: "here" } }));
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Go live for this RDV?")).toBeTruthy();
    expect(b.calls.some((c) => c.name.startsWith("live."))).toBe(false);
    await fireEvent.press(screen.getByTestId("rdv-offer-dismiss"));
    expect(screen.queryByText("Go live for this RDV?")).toBeNull();
    expect(b.calls.some((c) => c.name.startsWith("live."))).toBe(false);
  });

  it("opens the Go live sheet with only the RDV's crews that the person is in chosen, and starts nothing", async () => {
    const second = { ...crewsRow, id: "crew-2", name: "Day Drivers" };
    const b = backend(() => [open({ crew_ids: ["crew-1", "crew-9"] })], { "crews.list_my_crews": () => [crewsRow, second] });
    const { shell } = await mount(b);
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rdv-here"));
    await fireEvent.press(await screen.findByTestId("rdv-offer-go-live"));
    const row = (name: string) => screen.findByTestId(`golive-crew-${name}`);
    expect((await row("Night Cruisers")).props.accessibilityState.checked).toBe(true);
    expect((await row("Day Drivers")).props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("golive-start")).toBeTruthy();
    expect(b.calls.some((c) => c.name.startsWith("live."))).toBe(false);
  });

  it("says so when the reading is outside the radius and offers nothing", async () => {
    const b = backend(() => [open()], { "fn.record_arrival": () => { throw new AppError("outside_radius"); } });
    const { shell } = await mount(b);
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rdv-here"));
    expect(await screen.findByText(/not at the RDV yet/)).toBeTruthy();
    expect(screen.queryByText("Go live for this RDV?")).toBeNull();
  });

  it("is not offered before the window opens", async () => {
    const { shell } = await mount(backend(() => [rdvRow({ starts_at: iso(Date.now() + 2 * H), end_at: iso(Date.now() + 5 * H) })]));
    shell.pins.press("rdvs:r1");
    await screen.findByTestId("rdv-host");
    expect(screen.queryByTestId("rdv-here")).toBeNull();
  });

  it("is not offered once arrived", async () => {
    const { shell } = await mount(backend(() => [{ ...open(), arrived: true }]));
    shell.pins.press("rdvs:r1");
    expect(await screen.findByText("You're marked as arrived.")).toBeTruthy();
    expect(screen.queryByTestId("rdv-here")).toBeNull();
  });
});

describe("live arrival", () => {
  it("records arrival once for a live member inside the radius during the window", async () => {
    const b = backend(() => [rdvRow({ starts_at: iso(Date.now() - 10 * 60000), end_at: iso(Date.now() + 2 * H) })]);
    const { shell } = await mount(b);
    const at = { userId: "user-1", crewIds: ["crew-1"], lat: 43.65, lng: -79.38, heading: null, ts: Date.now() };
    await act(async () => shell.locationStream.publish(at));
    await act(async () => shell.locationStream.publish({ ...at, ts: Date.now() + 1 }));
    await waitFor(() => expect(b.invoked.filter((i) => i.name === "record_arrival")).toHaveLength(1));
    expect(b.invoked.find((i) => i.name === "record_arrival")!.body).toEqual({ rdv_id: "r1", position: { lat: 43.65, lng: -79.38 }, method: "live" });
  });

  it("stays quiet when the member is outside the radius", async () => {
    const b = backend(() => [rdvRow({ starts_at: iso(Date.now() - 10 * 60000), end_at: iso(Date.now() + 2 * H) })]);
    const { shell } = await mount(b);
    await act(async () => shell.locationStream.publish({ userId: "user-1", crewIds: ["crew-1"], lat: 43.7, lng: -79.38, heading: null, ts: Date.now() }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(b.invoked).toEqual([]);
  });
});

describe("create", () => {
  const place: Place = { name: "Harbour lot", kind: "Park", address: "1 Main St, Toronto", lat: 43.65, lng: -79.38 };

  it("shows the disclaimer line, checks the title, and creates for the chosen crew", async () => {
    const b = backend(() => []);
    const { shell } = await mount(b);
    await act(async () => shell.navigate("RdvCreate", { place }));
    expect(await screen.findByText(DISCLAIMER_PLACES)).toBeTruthy();
    expect(screen.getByText("Harbour lot")).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("rdv-title"), "ab");
    await fireEvent.press(screen.getByTestId("rdv-save"));
    expect(await screen.findByText("RDV titles are 3 to 60 characters.")).toBeTruthy();
    expect(b.calls.some((c) => c.name === "rdvs.create_rdv")).toBe(false);

    await fireEvent.changeText(screen.getByTestId("rdv-title"), "Night cruise");
    await fireEvent.press(screen.getByTestId("rdv-kind-cruise"));
    await fireEvent.press(screen.getByTestId("rdv-radius-plus"));
    await fireEvent.press(screen.getByTestId("rdv-save"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "rdvs.create_rdv")).toBeTruthy());
    const args = b.calls.find((c) => c.name === "rdvs.create_rdv")!.args as Record<string, unknown>;
    expect(args).toMatchObject({ p_title: "Night cruise", p_kind: "cruise", p_place_name: "Harbour lot", p_lat: 43.65, p_lng: -79.38, p_area_name: "Toronto", p_ends_at: null, p_note: null, p_crew_ids: ["crew-1"], p_radius_m: 200 });
    expect(Date.parse(args.p_starts_at as string)).toBeGreaterThan(Date.now());
  });

  it("makes a private event name its area before it can be saved", async () => {
    const b = backend(() => []);
    const { shell } = await mount(b);
    await act(async () => shell.navigate("RdvCreate", { place }));
    await fireEvent.changeText(await screen.findByTestId("rdv-title"), "Garage night");
    await fireEvent.press(screen.getByTestId("rdv-kind-private_event"));
    await fireEvent.press(screen.getByTestId("rdv-save"));
    expect(await screen.findByText(/Name the general area/)).toBeTruthy();
    expect(b.calls.some((c) => c.name === "rdvs.create_rdv")).toBe(false);
    await fireEvent.changeText(screen.getByTestId("rdv-area"), "Leslieville");
    await fireEvent.press(screen.getByTestId("rdv-save"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "rdvs.create_rdv")).toBeTruthy());
    expect(b.calls.find((c) => c.name === "rdvs.create_rdv")!.args).toMatchObject({ p_kind: "private_event", p_area_name: "Leslieville" });
  });

  it("chooses the place through the place picker when none was carried over", async () => {
    const b = backend(() => []);
    const { shell } = await mount(b);
    await act(async () => shell.navigate("RdvCreate", {}));
    const pick = jest.spyOn(shell.places, "pick").mockResolvedValue(place);
    await fireEvent.press(await screen.findByTestId("rdv-place"));
    expect(await screen.findByText("Harbour lot")).toBeTruthy();
    expect(pick).toHaveBeenCalled();
  });

  it("keeps the radius within 50 to 500", async () => {
    const { shell } = await mount(backend(() => []));
    await act(async () => shell.navigate("RdvCreate", { place }));
    const value = () => screen.getByTestId("rdv-radius-value").props.children;
    expect(await screen.findByTestId("rdv-radius-value")).toBeTruthy();
    expect(value()).toBe("150 m");
    for (let i = 0; i < 10; i++) await fireEvent.press(screen.getByTestId("rdv-radius-plus"));
    expect(value()).toBe("500 m");
    for (let i = 0; i < 12; i++) await fireEvent.press(screen.getByTestId("rdv-radius-minus"));
    expect(value()).toBe("50 m");
  });
});

describe("reminders", () => {
  it("schedules a local reminder for an RDV answered going and asks for nothing new", async () => {
    await mount(backend(() => [rdvRow({ my_answer: "going" }), rdvRow({ id: "r2", my_answer: "cant" })]));
    await waitFor(() => expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1));
    const call = mockNotifications.scheduleNotificationAsync.mock.calls[0] as unknown as [any];
    expect(call[0]).toMatchObject({ identifier: "rdv-r1", content: { title: "Sunday meet" }, trigger: { type: "date" } });
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("cancels a scheduled reminder when the RDV is cancelled", async () => {
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: "rdv-r1", content: { title: "Sunday meet", body: "x", data: { rdvReminder: true, at: 1 } } },
      { identifier: "rdv-live", content: { title: "You're live", data: {} } },
    ]);
    await mount(backend(() => [rdvRow({ my_answer: "going", status: "cancelled" })]));
    await waitFor(() => expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("rdv-r1"));
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith("rdv-live");
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("schedules nothing without the notification permission", async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true }).mockResolvedValue({ granted: false, canAskAgain: true });
    await mount(backend(() => [rdvRow({ my_answer: "going" })]));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("Map list", () => {
  it("opens an RDV once when its row in the crew sheet is pressed", async () => {
    const { shell } = await mount(backend(() => [rdvRow()]));
    const press = jest.spyOn(shell.pins, "press");
    await fireEvent.press(await screen.findByTestId("map-rdv-rdvs:r1"));
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledWith("rdvs:r1");
  });
});

describe("Crew detail RDVs", () => {
  it("lists the crew's upcoming RDVs and opens one", async () => {
    const { shell } = await mount(backend(() => [rdvRow(), rdvRow({ id: "elsewhere", title: "Other crew", crew_ids: ["crew-9"] }), rdvRow({ id: "old", title: "Old meet", starts_at: iso(Date.now() - 30 * H), end_at: iso(Date.now() - 27 * H) })]));
    shell.navigate("CrewDetail", { id: "crew-1" });
    expect(await screen.findByText("Upcoming RDVs")).toBeTruthy();
    expect(screen.getByText("Sunday meet")).toBeTruthy();
    expect(screen.queryByText("Other crew")).toBeNull();
    expect(screen.queryByText("Old meet")).toBeNull();
    await fireEvent.press(screen.getByTestId("rdv-row-r1"));
    expect(await screen.findByTestId("rdv-host")).toBeTruthy();
  });

  it("shows an empty state when the crew has none", async () => {
    const { shell } = await mount(backend(() => []));
    shell.navigate("CrewDetail", { id: "crew-1" });
    expect(await screen.findByTestId("crew-rdvs-empty")).toBeTruthy();
  });
});

describe("Stats", () => {
  it("adds a Stats row to Me showing the person's own meets attended", async () => {
    await mount(backend(() => [], { "rdvs.my_meets_attended": () => 3 }));
    await fireEvent.press(screen.getAllByText("Me")[0]!);
    await fireEvent.press(await screen.findByTestId("me-stats"));
    expect((await screen.findByTestId("stats-meets")).props.children).toBe("3");
    expect(screen.getByText("Meets attended")).toBeTruthy();
  });
});
