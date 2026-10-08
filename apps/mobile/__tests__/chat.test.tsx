import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, AppState, Text as RNText } from "react-native";
import { DISCLAIMER_ROOM, ShellApp, TERMS_VERSION } from "@rdv/core";
import { CHAT_COMPOSER_ACTIONS_SLOT } from "@rdv/core/chat";
import { makeBackend, makeShell, profileRow } from "./helpers";

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
const mockNotifications = require("expo-notifications");
const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

const H = 3600000;
const iso = (ms: number) => new Date(ms).toISOString();

const crewRow = {
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [
    { user_id: "user-1", handle: "tester", avatar_path: null, car_icon: "gt", role: "owner", live: false },
    { user_id: "user-2", handle: "ace", avatar_path: null, car_icon: "gt", role: "member", live: false },
    { user_id: "user-3", handle: "bolt", avatar_path: null, car_icon: "gt", role: "member", live: false },
  ],
};

const roomRow = (over: Record<string, unknown> = {}) => ({
  id: "room-crew", kind: "crew", name: "Night Cruisers", description: null, crew_id: "crew-1", rdv_id: null, status: "active", role: "member", muted: false,
  can_moderate: true, members: 3, unread: 0, last_message: null, ...over,
});
const inviteRow = (over: Record<string, unknown> = {}) => roomRow({ id: "room-inv", kind: "invite", name: "Late night", crew_id: null, role: "owner", can_moderate: true, ...over });
const msgRow = (over: Record<string, unknown> = {}) => ({
  id: "m1", sender_id: "user-2", handle: "ace", avatar_path: null, car_icon: "gt", body: "see you at ten", created_at: iso(Date.now() - 60000), ...over,
});
const people = [
  { user_id: "user-1", handle: "tester", avatar_path: null, car_icon: "gt", role: "owner" },
  { user_id: "user-2", handle: "ace", avatar_path: null, car_icon: "gt", role: "member" },
];

type Handlers = Record<string, (args: any) => unknown>;

function backend(state: { rooms: unknown[]; messages?: unknown[] }, extra: Handlers = {}) {
  const b = makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crewRow],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "places.list_pins": () => [],
    "rdvs.list_rdvs": () => [],
    "chat.list_rooms": () => state.rooms,
    "chat.list_messages": () => state.messages ?? [],
    "chat.list_room_members": () => people,
    "chat.mark_read": () => null,
    "chat.send_message": (a) => ({ id: "sent-1", room_id: a.p_room, sender_id: "user-1", handle: "tester", body: a.p_body, created_at: iso(Date.now()) }),
    "chat.delete_message": () => null,
    "chat.set_room_muted": () => null,
    "chat.create_room": () => "room-new",
    ...extra,
  });
  const handlers = new Map<string, (payload: any) => void>();
  const names: string[] = [];
  b.channel = (name: string) => {
    names.push(name);
    return {
      on: (event: string, fn: (payload: any) => void) => void handlers.set(event, fn),
      subscribe: () => undefined, send: async () => undefined, track: async () => undefined, untrack: async () => undefined, unsubscribe: async () => undefined,
    };
  };
  return Object.assign(b, { inbox: handlers, channelNames: names });
}

async function mount(b: ReturnType<typeof backend>, flags: Record<string, boolean> = {}) {
  const shell = makeShell(b, { chat: true, ...flags });
  await render(<ShellApp shell={shell} />);
  await waitFor(() => expect(b.calls.some((c) => c.name === "chat.list_rooms")).toBe(true));
  return shell;
}

const openRoomsTab = async () => {
  await fireEvent.press((await screen.findAllByText("Rooms"))[0]!);
};
const tapAlert = (label: string) => {
  const buttons = (alertSpy.mock.calls.at(-1)![2] ?? []) as { text: string; onPress?: () => unknown }[];
  return act(async () => void (await buttons.find((x) => x.text === label)!.onPress?.()));
};
const emit = (b: ReturnType<typeof backend>, event: string, payload: unknown) => act(async () => void b.inbox.get(event)!(payload));

const setApp = (state: string) => void ((AppState as any).currentState = state);

beforeEach(() => {
  setApp("active");
  jest.clearAllMocks();
  alertSpy.mockClear();
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
});

describe("Rooms tab", () => {
  it("lists crew rooms first, then other rooms, with the last message line and an unread badge", async () => {
    const b = backend({
      rooms: [
        roomRow({ unread: 3, last_message: { id: "m1", sender_id: "user-2", handle: "ace", body: "see you at ten", created_at: iso(Date.now() - 5 * 60000) } }),
        inviteRow({ last_message: { id: "m2", sender_id: "user-1", handle: "tester", body: "on my way", created_at: iso(Date.now() - 2 * H) } }),
      ],
    });
    await mount(b);
    await openRoomsTab();
    expect(await screen.findByTestId("room-room-crew")).toBeTruthy();
    expect(screen.getAllByTestId(/^room-room-/).map((r) => r.props.testID)).toEqual(["room-room-crew", "room-room-inv"]);
    expect(screen.getByText("@ace: see you at ten")).toBeTruthy();
    expect(screen.getByText("You: on my way")).toBeTruthy();
    expect(screen.getByTestId("unread-room-crew").props.children).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByTestId("unread-room-inv")).toBeNull();
    expect(b.channelNames.filter((n: string) => n.startsWith("inbox:"))).toEqual(["inbox:user-1"]);
  });

  it("shows an empty state with a way to start a room", async () => {
    await mount(backend({ rooms: [] }));
    await openRoomsTab();
    expect(await screen.findByText("No rooms yet")).toBeTruthy();
    expect(screen.getByTestId("rooms-new")).toBeTruthy();
  });

  it("asks for notification permission the first time the tab opens, not at launch, and only once", async () => {
    await mount(backend({ rooms: [roomRow()] }));
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    await openRoomsTab();
    await waitFor(() => expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1));
    await fireEvent.press((await screen.findAllByText("Crews"))[0]!);
    await openRoomsTab();
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("chat keeps working when the permission is refused", async () => {
    mockNotifications.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await mount(backend({ rooms: [roomRow()] }));
    await openRoomsTab();
    expect(await screen.findByTestId("room-room-crew")).toBeTruthy();
  });

  it("adds no tab when the chat flag is off", async () => {
    const b = backend({ rooms: [] });
    const shell = makeShell(b, { chat: false });
    await render(<ShellApp shell={shell} />);
    await screen.findAllByText("Crews");
    expect(screen.queryAllByText("Rooms")).toHaveLength(0);
    expect(b.channelNames.filter((n: string) => n.startsWith("inbox:"))).toEqual([]);
  });
});

describe("Room screen", () => {
  const open = async (b: ReturnType<typeof backend>) => {
    await mount(b);
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId("room-room-crew"));
    await screen.findByTestId("composer-input");
  };

  it("shows the messages, the safety line, and marks the room read", async () => {
    const b = backend({ rooms: [roomRow({ unread: 2 })], messages: [msgRow()] });
    await open(b);
    expect(await screen.findByText("see you at ten")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_ROOM)).toBeTruthy();
    await waitFor(() => expect(b.calls.some((c) => c.name === "chat.mark_read")).toBe(true));
    expect(b.calls.find((c) => c.name === "chat.list_messages")!.args).toMatchObject({ p_room: "room-crew" });
  });

  it("shows an empty state for a room with no messages", async () => {
    await open(backend({ rooms: [roomRow()], messages: [] }));
    expect(await screen.findByTestId("room-empty")).toBeTruthy();
  });

  it("sends a message from the composer and clears it", async () => {
    const b = backend({ rooms: [roomRow()], messages: [] });
    await open(b);
    expect(screen.getByTestId("composer-send").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId("composer-input"), "  hello crew  ");
    await fireEvent.press(screen.getByTestId("composer-send"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.send_message")?.args).toEqual({ p_room: "room-crew", p_body: "  hello crew  " }));
    expect(await screen.findByText("hello crew")).toBeTruthy();
    expect(screen.getByTestId("composer-input").props.value).toBe("");
  });

  it("shows the mapped error when sending fails", async () => {
    const { AppError } = require("@rdv/core");
    const b = backend({ rooms: [roomRow()] }, { "chat.send_message": () => { throw new AppError("rate_limited"); } });
    await open(b);
    await fireEvent.changeText(screen.getByTestId("composer-input"), "spam");
    await fireEvent.press(screen.getByTestId("composer-send"));
    expect(await screen.findByText("Too many attempts. Try again later.")).toBeTruthy();
    expect(screen.getByTestId("composer-input").props.value).toBe("spam");
  });

  it("shows a live message from the inbox channel in the open room", async () => {
    const b = backend({ rooms: [roomRow()], messages: [] });
    await open(b);
    await emit(b, "message", { room_id: "room-crew", message_id: "live-1", sender_id: "user-2", handle: "ace", text: "just landed", created_at: iso(Date.now()) });
    expect(await screen.findByText("just landed")).toBeTruthy();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("reserves a place beside the composer for the walkie-talkie Talk button, filled through a core slot", async () => {
    const b = backend({ rooms: [roomRow()] });
    const shell = makeShell(b, { chat: true });
    const Talk = ({ room }: { room: { roomId: string; kind: string; members: { handle: string }[]; canModerate: boolean } }) => (
      <RNText testID="talk">{`Talk ${room.roomId} ${room.kind} ${room.members.map((m) => m.handle).join(",")} ${room.canModerate}`}</RNText>
    );
    shell.addSlot(CHAT_COMPOSER_ACTIONS_SLOT, Talk);
    await render(<ShellApp shell={shell} />);
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId("room-room-crew"));
    expect(screen.getByTestId("composer-actions")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("talk").props.children).toBe("Talk room-crew crew tester,ace true"));
  });

  it("lets the sender delete their own message and a moderator delete anyone's, with a confirmation", async () => {
    const b = backend({ rooms: [roomRow({ can_moderate: true })], messages: [msgRow()] });
    await open(b);
    await fireEvent(await screen.findByTestId("msg-m1"), "longPress");
    await tapAlert("Delete");
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.delete_message")?.args).toEqual({ p_message: "m1" }));
    await waitFor(() => expect(screen.queryByText("see you at ten")).toBeNull());
  });

  it("offers no delete on someone else's message to a plain member", async () => {
    const b = backend({ rooms: [roomRow({ can_moderate: false })], messages: [msgRow()] });
    await open(b);
    await fireEvent(await screen.findByTestId("msg-m1"), "longPress");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows a closed RDV room as read-only", async () => {
    const b = backend({ rooms: [roomRow({ id: "room-rdv", kind: "rdv", crew_id: null, rdv_id: "r1", name: "Sunday meet", status: "closed", last_message: { id: "m1", sender_id: "user-2", handle: "ace", body: "bye", created_at: iso(Date.now()) } })], messages: [msgRow({ body: "bye" })] });
    await mount(b);
    await openRoomsTab();
    expect(await screen.findByText(/Closed/)).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("room-room-rdv"));
    expect(await screen.findByTestId("room-closed")).toBeTruthy();
    expect(screen.queryByTestId("composer-input")).toBeNull();
  });

  it("says so when the room is gone", async () => {
    const state = { rooms: [roomRow()] as unknown[] };
    const b = backend(state);
    await open(b);
    state.rooms = [];
    await emit(b, "room_changed", { room_id: "room-crew" });
    expect(await screen.findByText("This room is gone")).toBeTruthy();
  });
});

describe("live messages and notifications", () => {
  it("raises a local notification with the handle, room and text for a message from someone else while away from the room", async () => {
    const state = { rooms: [roomRow()] as unknown[] };
    const b = backend(state);
    await mount(b);
    await emit(b, "message", { room_id: "room-crew", message_id: "n1", sender_id: "user-2", handle: "ace", text: "cruise at nine", created_at: iso(Date.now()) });
    await waitFor(() => expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalled());
    expect(mockNotifications.scheduleNotificationAsync.mock.calls[0][0].content).toMatchObject({ title: "@ace in Night Cruisers", body: "cruise at nine" });
    state.rooms = [roomRow({ unread: 1 })];
    await openRoomsTab();
    expect(await screen.findByTestId("unread-room-crew")).toBeTruthy();
    expect(JSON.stringify(b.calls)).not.toContain("cruise at nine");
  });

  it("stays quiet for a muted room, your own message, and a room you are reading", async () => {
    const state = { rooms: [roomRow({ muted: true })] as unknown[] };
    const b = backend(state);
    await mount(b);
    await emit(b, "message", { room_id: "room-crew", message_id: "n1", sender_id: "user-2", handle: "ace", text: "muted", created_at: iso(Date.now()) });
    await emit(b, "message", { room_id: "room-crew", message_id: "n2", sender_id: "user-1", handle: "tester", text: "mine", created_at: iso(Date.now()) });
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    state.rooms = [roomRow({ muted: true, unread: 1 })];
    await openRoomsTab();
    expect(await screen.findByText("1")).toBeTruthy();
  });

  it("notifies when the app is in the background even on the room's own screen", async () => {
    const b = backend({ rooms: [roomRow()], messages: [] });
    await mount(b);
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId("room-room-crew"));
    await screen.findByTestId("composer-input");
    setApp("background");
    await emit(b, "message", { room_id: "room-crew", message_id: "n3", sender_id: "user-2", handle: "ace", text: "hello?", created_at: iso(Date.now()) });
    await waitFor(() => expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalled());
  });

  it("refreshes the list when a room is added", async () => {
    const state = { rooms: [roomRow()] as unknown[] };
    const b = backend(state);
    await mount(b);
    await openRoomsTab();
    state.rooms = [roomRow(), inviteRow()];
    await emit(b, "room_changed", { room_id: "room-inv" });
    expect(await screen.findByTestId("room-room-inv")).toBeTruthy();
  });
});

describe("invite rooms", () => {
  it("creates a room with people picked from the person's crews", async () => {
    const state = { rooms: [roomRow()] as unknown[] };
    const b = backend(state, { "chat.create_room": () => { state.rooms = [roomRow(), inviteRow({ id: "room-new" })]; return "room-new"; } });
    await mount(b);
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId("rooms-new"));
    await fireEvent.changeText(await screen.findByTestId("room-name"), "Late night");
    expect(screen.queryByTestId("pick-tester")).toBeNull();
    await fireEvent.press(screen.getByTestId("pick-ace"));
    await fireEvent.press(screen.getByTestId("room-create"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.create_room")?.args).toEqual({ p_name: "Late night", p_description: null, p_member_ids: ["user-2"] }));
    expect(await screen.findByTestId("composer-input")).toBeTruthy();
  });

  it("will not create a room with a short name", async () => {
    await mount(backend({ rooms: [] }));
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId("rooms-new"));
    await fireEvent.changeText(await screen.findByTestId("room-name"), "ab");
    expect(screen.getByTestId("room-create").props.accessibilityState.disabled).toBe(true);
  });

  const openInfo = async (b: ReturnType<typeof backend>, id: string) => {
    await mount(b);
    await openRoomsTab();
    await fireEvent.press(await screen.findByTestId(`room-${id}`));
    await fireEvent.press(await screen.findByTestId("room-info"));
  };

  it("lets the owner add and remove members, mute, and delete the room", async () => {
    const b = backend({ rooms: [roomRow(), inviteRow()] }, { "chat.add_room_member": () => null, "chat.remove_room_member": () => null, "chat.delete_room": () => null });
    await openInfo(b, "room-inv");
    expect(await screen.findByTestId("member-ace")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("room-add"));
    await fireEvent.press(await screen.findByTestId("add-bolt"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.add_room_member")?.args).toEqual({ p_room: "room-inv", p_user: "user-3" }));
    await fireEvent.press(screen.getByTestId("member-ace"));
    await tapAlert("Remove");
    await tapAlert("Remove");
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.remove_room_member")?.args).toEqual({ p_room: "room-inv", p_user: "user-2" }));
    await fireEvent(screen.getByLabelText("Mute room"), "valueChange", true);
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.set_room_muted")?.args).toEqual({ p_room: "room-inv", p_muted: true }));
    await fireEvent.press(screen.getByTestId("room-delete"));
    await tapAlert("Delete");
    await waitFor(() => expect(b.calls.some((c) => c.name === "chat.delete_room")).toBe(true));
  });

  it("transfers ownership to a member", async () => {
    const b = backend({ rooms: [roomRow(), inviteRow()] }, { "chat.transfer_room": () => null });
    await openInfo(b, "room-inv");
    await fireEvent.press(await screen.findByTestId("member-ace"));
    await tapAlert("Make owner");
    await tapAlert("Transfer");
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.transfer_room")?.args).toEqual({ p_room: "room-inv", p_user: "user-2" }));
  });

  it("lets a plain member leave but not manage members", async () => {
    const b = backend({ rooms: [roomRow(), inviteRow({ role: "member", can_moderate: false })] }, { "chat.leave_room": () => null });
    await openInfo(b, "room-inv");
    await screen.findByText("@ace");
    expect(screen.queryByTestId("room-add")).toBeNull();
    expect(screen.queryByTestId("room-delete")).toBeNull();
    await fireEvent.press(screen.getByTestId("room-leave"));
    await tapAlert("Leave");
    await waitFor(() => expect(b.calls.some((c) => c.name === "chat.leave_room")).toBe(true));
  });

  it("offers no member management or leaving in a crew room", async () => {
    await openInfo(backend({ rooms: [roomRow()] }), "room-crew");
    await screen.findByText("@ace");
    expect(screen.queryByTestId("room-add")).toBeNull();
    expect(screen.queryByTestId("room-leave")).toBeNull();
    expect(screen.queryByTestId("room-delete")).toBeNull();
  });
});

describe("entry points", () => {
  it("opens the crew room from crew detail", async () => {
    const b = backend({ rooms: [roomRow({ unread: 2 })] });
    const shell = await mount(b);
    shell.navigate("CrewDetail", { id: "crew-1" });
    await fireEvent.press(await screen.findByTestId("crew-room-open"));
    expect(await screen.findByTestId("composer-input")).toBeTruthy();
  });

  const rdvRow = (over: Record<string, unknown> = {}) => ({
    id: "r1", host_id: "user-1", host_handle: "tester", title: "Sunday meet", kind: "meet", area_name: "Waterfront",
    starts_at: iso(Date.now() + 5 * H), ends_at: null, end_at: iso(Date.now() + 8 * H), radius_m: 150, note: null, status: "scheduled",
    crew_ids: ["crew-1"], place: { name: "Harbour lot", lat: 43.65, lng: -79.38 }, going: 1, maybe: 0, cant: 0, my_answer: "going", arrived: false, ...over,
  });

  it("lets the host open a room from the RDV detail, without the chat module importing rdvs", async () => {
    const state = { rooms: [roomRow()] as unknown[] };
    const b = backend(state, {
      "rdvs.list_rdvs": () => [rdvRow()],
      "rdvs.list_rsvps": () => [],
      "chat.open_rdv_room": () => {
        state.rooms = [roomRow(), roomRow({ id: "room-rdv", kind: "rdv", crew_id: null, rdv_id: "r1", name: "Sunday meet", role: "member" })];
        return "room-rdv";
      },
    });
    const shell = await mount(b, { rdvs: true });
    await waitFor(() => expect(shell.pins.store.get().length).toBe(1));
    shell.pins.press("rdvs:r1");
    await fireEvent.press(await screen.findByTestId("rdv-room-create"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "chat.open_rdv_room")?.args).toEqual({ p_rdv: "r1" }));
    expect(await screen.findByTestId("composer-input")).toBeTruthy();
  });

  it("shows no create button to someone who is not the host, and an open button once the room exists", async () => {
    const b = backend({ rooms: [roomRow(), roomRow({ id: "room-rdv", kind: "rdv", crew_id: null, rdv_id: "r1", name: "Sunday meet" })] }, { "rdvs.list_rdvs": () => [rdvRow({ host_id: "user-2" })], "rdvs.list_rsvps": () => [] });
    const shell = await mount(b, { rdvs: true });
    await waitFor(() => expect(shell.pins.store.get().length).toBe(1));
    shell.pins.press("rdvs:r1");
    expect(await screen.findByTestId("rdv-room-open")).toBeTruthy();
    expect(screen.queryByTestId("rdv-room-create")).toBeNull();
  });

  it("offers a non-host nothing before the room exists", async () => {
    const b = backend({ rooms: [roomRow()] }, { "rdvs.list_rdvs": () => [rdvRow({ host_id: "user-2" })], "rdvs.list_rsvps": () => [] });
    const shell = await mount(b, { rdvs: true });
    await waitFor(() => expect(shell.pins.store.get().length).toBe(1));
    shell.pins.press("rdvs:r1");
    await screen.findByTestId("rdv-host");
    expect(screen.queryByTestId("rdv-room-create")).toBeNull();
    expect(screen.queryByTestId("rdv-room-open")).toBeNull();
  });
});

describe("updated terms", () => {
  it("asks a person on an older version to accept before showing the app, then lets them in", async () => {
    const b = backend({ rooms: [] }, { "accounts.my_profile": () => [profileRow({ terms_version: "v1" })], "accounts.accept_terms": () => null });
    const shell = makeShell(b, { chat: true });
    await render(<ShellApp shell={shell} />);
    expect(await screen.findByText("Updated safety terms")).toBeTruthy();
    expect(screen.getByText("10. Chat and voice")).toBeTruthy();
    expect(screen.queryAllByText("Rooms")).toHaveLength(0);
    await fireEvent.press(screen.getByTestId("terms-accept"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "accounts.accept_terms")?.args).toEqual({ p_version: TERMS_VERSION }));
    expect((await screen.findAllByText("Rooms")).length).toBeGreaterThan(0);
  });

  it("goes straight in when the current version is accepted", async () => {
    const b = backend({ rooms: [] }, { "accounts.my_profile": () => [profileRow({ terms_version: TERMS_VERSION })] });
    await mount(b);
    expect(screen.queryByText("Updated safety terms")).toBeNull();
  });
});
