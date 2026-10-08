import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, AppState } from "react-native";
import { DISCLAIMER_ROOM, ShellApp, createShell } from "@rdv/core";
import type { Voice, VoiceStatus } from "@rdv/core/voice";
import { createWalkieModule } from "@rdv/walkie";
import { config, makeBackend, profileRow } from "./helpers";
import { modules } from "../src/modules";

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

const iso = (ms: number) => new Date(ms).toISOString();

const crewRow = (voiceOff = false) => ({
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [
    { user_id: "user-1", handle: "tester", avatar_path: null, car_icon: "gt", role: "owner", live: false },
    { user_id: "user-2", handle: "ace", avatar_path: null, car_icon: "gt", role: "member", live: false, voice_off: voiceOff },
  ],
});
const room = {
  id: "room-crew", kind: "crew", name: "Night Cruisers", description: null, crew_id: "crew-1", rdv_id: null, status: "active", role: "member", muted: false,
  can_moderate: true, members: 2, unread: 0, last_message: null,
};
const people = [
  { user_id: "user-1", handle: "tester", avatar_path: null, car_icon: "gt", role: "owner" },
  { user_id: "user-2", handle: "ace", avatar_path: null, car_icon: "drift", role: "member" },
];

function fakeVoice() {
  const log: string[] = [];
  const levelFns = new Set<(l: Record<string, number>) => void>();
  const speakerFns = new Set<(i: string[]) => void>();
  const statusFns = new Set<(s: VoiceStatus) => void>();
  const voice: Voice & { log: string[]; levelFns: typeof levelFns; speakerFns: typeof speakerFns } = {
    log,
    levelFns,
    speakerFns,
    connect: jest.fn(async ({ token }) => void log.push(`connect:${token}`)),
    disconnect: jest.fn(async () => void log.push("disconnect")),
    setMicOpen: jest.fn(async (open: boolean) => void log.push(open ? "mic-on" : "mic-off")),
    requestMicPermission: jest.fn(async () => true),
    setSoundMuted: jest.fn(),
    identity: () => "ident-me",
    onStatus: (fn) => (statusFns.add(fn), () => statusFns.delete(fn)),
    onSpeakers: (fn) => (speakerFns.add(fn), () => speakerFns.delete(fn)),
    onParticipants: () => () => undefined,
    onLevels: (fn) => (levelFns.add(fn), () => levelFns.delete(fn)),
  };
  return voice;
}

function setup(opts: { token?: Record<string, unknown>; disclaimerSeen?: boolean; walkieFlag?: boolean; voiceOff?: boolean } = {}) {
  const voice = fakeVoice();
  const seen = { value: opts.disclaimerSeen ?? false };
  const b = makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crewRow(opts.voiceOff)],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "places.list_pins": () => [],
    "rdvs.list_rdvs": () => [],
    "chat.list_rooms": () => [room],
    "chat.list_messages": () => [],
    "chat.list_room_members": () => people,
    "chat.mark_read": () => null,
    "crews.set_voice_access": () => null,
    "fn.walkie_token": () => ({ token: "tok-1", url: "wss://voice.test", can_publish: true, expires_in: 300, voice_off_crews: [], identities: { "ident-me": "user-1", "ident-ace": "user-2" }, ...opts.token }),
  });
  const shell = createShell({ ...config, flags: { rdvs: false, chat: true, walkie: opts.walkieFlag ?? true } }, b);
  const explainMic = jest.fn(async () => true);
  for (const m of modules) {
    if (m.id === "walkie") {
      createWalkieModule({
        voice,
        indicator: { show: jest.fn(async () => undefined), hide: jest.fn(async () => undefined) },
        explainMic,
        disclaimerSeen: { get: async () => seen.value, set: async () => void (seen.value = true) },
      }).register(shell);
    } else m.register(shell);
  }
  return { shell, b, voice, explainMic, seen };
}

const openRoom = async () => {
  await fireEvent.press((await screen.findAllByText("Rooms"))[0]!);
  await fireEvent.press(await screen.findByTestId("room-room-crew"));
  await screen.findByTestId("composer-input");
};
const mount = async (s: ReturnType<typeof setup>) => {
  await render(<ShellApp shell={s.shell} />);
  await openRoom();
};

const appStateHandlers: ((state: string) => void)[] = [];
jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, fn: (state: string) => void) => {
  appStateHandlers.push(fn);
  return { remove: () => void appStateHandlers.splice(appStateHandlers.indexOf(fn), 1) };
}) as never);

beforeEach(() => {
  (AppState as any).currentState = "active";
  alertSpy.mockClear();
});

describe("room voice", () => {
  it("joins the room's channel on opening it, listening, and leaves on going back", async () => {
    const s = setup();
    await mount(s);
    await waitFor(() => expect(s.voice.connect).toHaveBeenCalledWith({ url: "wss://voice.test", token: "tok-1" }));
    expect(s.b.invoked.find((i) => i.name === "walkie_token")!.body).toEqual({ room_id: "room-crew" });
    expect(s.voice.log).not.toContain("mic-on");
    expect(screen.getByTestId("talk-button").props.accessibilityState.disabled).toBe(false);
    await act(async () => void screen.unmount());
    expect(s.voice.disconnect).toHaveBeenCalled();
  });

  it("opens the microphone only while Talk is held, asks for it on the first press, and shows On the air", async () => {
    const s = setup();
    await mount(s);
    await waitFor(() => expect(screen.getByTestId("talk-button").props.accessibilityState.disabled).toBe(false));
    await fireEvent(screen.getByTestId("talk-button"), "pressIn");
    expect(s.explainMic).toHaveBeenCalledTimes(1);
    expect(s.voice.requestMicPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("on-the-air-self")).toBeTruthy();
    expect(s.voice.log.at(-1)).toBe("mic-on");
    await fireEvent(screen.getByTestId("talk-button"), "pressOut");
    await waitFor(() => expect(screen.queryByTestId("on-the-air-self")).toBeNull());
    expect(s.voice.log.at(-1)).toBe("mic-off");
  });

  it("closes the microphone when the app leaves the foreground", async () => {
    const s = setup();
    await mount(s);
    await waitFor(() => expect(screen.getByTestId("talk-button").props.accessibilityState.disabled).toBe(false));
    await fireEvent(screen.getByTestId("talk-button"), "pressIn");
    await screen.findByTestId("on-the-air-self");
    await act(async () => void appStateHandlers.forEach((fn) => fn("background")));
    await waitFor(() => expect(s.voice.log.at(-1)).toBe("mic-off"));
  });

  it("shows who is talking from the audio service and the server roster, with handle and level", async () => {
    const s = setup();
    await mount(s);
    await waitFor(() => expect(s.voice.connect).toHaveBeenCalled());
    await act(async () => s.voice.speakerFns.forEach((fn) => fn(["ident-ace"])));
    expect(await screen.findByTestId("talker-user-2")).toBeTruthy();
    expect(screen.getByText("@ace")).toBeTruthy();
    await act(async () => s.voice.levelFns.forEach((fn) => fn({ "ident-ace": 0.5 })));
    expect(screen.getByTestId("meter-user-2").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: "50%" })]));
    await act(async () => s.voice.speakerFns.forEach((fn) => fn([])));
    await waitFor(() => expect(screen.queryByTestId("talker-user-2")).toBeNull());
  });

  it("does not show anyone talking because of a forged broadcast, and opens no member channel", async () => {
    const s = setup();
    const channel = jest.fn();
    s.b.channel = channel as never;
    await mount(s);
    await waitFor(() => expect(s.voice.connect).toHaveBeenCalled());
    expect(channel.mock.calls.some(([name]) => String(name).startsWith("walkie:"))).toBe(false);
    await act(async () => s.voice.speakerFns.forEach((fn) => fn(["forged-identity"])));
    expect(screen.queryByTestId("talker-user-2")).toBeNull();
  });

  it("shows a disabled button and the crew name when voice is off", async () => {
    const s = setup({ token: { can_publish: false, voice_off_crews: ["Night Cruisers"] } });
    await mount(s);
    expect(await screen.findByText("Voice is off for you in Night Cruisers")).toBeTruthy();
    expect(screen.getByTestId("talk-button").props.accessibilityState.disabled).toBe(true);
    await fireEvent(screen.getByTestId("talk-button"), "pressIn");
    expect(s.voice.log).not.toContain("mic-on");
  });

  it("shows the room safety line on first use until dismissed, then not again", async () => {
    const s = setup();
    await mount(s);
    const line = await screen.findByTestId("walkie-disclaimer");
    expect(line).toBeTruthy();
    expect(screen.getAllByText(DISCLAIMER_ROOM).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText("Got it"));
    expect(screen.queryByTestId("walkie-disclaimer")).toBeNull();
    expect(s.seen.value).toBe(true);
  });

  it("mutes the room sound without leaving", async () => {
    const s = setup({ disclaimerSeen: true });
    await mount(s);
    await waitFor(() => expect(s.voice.connect).toHaveBeenCalled());
    await fireEvent.press(await screen.findByTestId("walkie-mute"));
    expect(s.voice.setSoundMuted).toHaveBeenLastCalledWith(true);
    expect(s.voice.disconnect).not.toHaveBeenCalled();
  });

  it("lets the person leave the channel and rejoin", async () => {
    const s = setup({ disclaimerSeen: true });
    await mount(s);
    await waitFor(() => expect(screen.getByTestId("walkie-leave")).toBeTruthy());
    await fireEvent.press(screen.getByTestId("walkie-leave"));
    expect(await screen.findByText("You left the voice channel.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("walkie-rejoin"));
    await waitFor(() => expect(s.voice.connect).toHaveBeenCalledTimes(2));
  });

  it("adds nothing to the room when the walkie flag is off", async () => {
    const s = setup({ walkieFlag: false });
    await mount(s);
    expect(screen.queryByTestId("talk-button")).toBeNull();
    expect(s.b.invoked.some((i) => i.name === "walkie_token")).toBe(false);
  });
});

describe("crew member voice control", () => {
  const openMember = async (s: ReturnType<typeof setup>) => {
    await render(<ShellApp shell={s.shell} />);
    await fireEvent.press((await screen.findAllByText("Crews"))[0]!);
    await fireEvent.press(await screen.findByTestId("crew-Night Cruisers"));
    await fireEvent.press(await screen.findByText("@ace"));
  };
  const tap = (label: string) => {
    const buttons = (alertSpy.mock.calls.at(-1)![2] ?? []) as { text: string; onPress?: () => unknown }[];
    return act(async () => void (await buttons.find((x) => x.text === label)!.onPress?.()));
  };

  it("turns a member's voice off and on through set_voice_access, with a confirmation for off", async () => {
    const s = setup();
    await openMember(s);
    await tap("Voice off");
    await tap("Voice off");
    await waitFor(() => expect(s.b.calls.find((c) => c.name === "crews.set_voice_access")?.args).toEqual({ p_crew: "crew-1", p_user: "user-2", p_allowed: false }));
  });

  it("offers Voice on for a member whose voice is off and marks them in the list", async () => {
    const s = setup({ voiceOff: true });
    await openMember(s);
    await tap("Voice on");
    await waitFor(() => expect(s.b.calls.find((c) => c.name === "crews.set_voice_access")?.args).toEqual({ p_crew: "crew-1", p_user: "user-2", p_allowed: true }));
  });

  it("offers no voice control when the walkie flag is off", async () => {
    const s = setup({ walkieFlag: false });
    await openMember(s);
    const labels = ((alertSpy.mock.calls.at(-1)![2] ?? []) as { text: string }[]).map((x) => x.text);
    expect(labels).not.toContain("Voice off");
    expect(labels).toContain("Remove from crew");
  });
});
