import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShellApp } from "@rdv/core";
import { pendingInvite } from "@rdv/accounts";
import { makeBackend, makeShell, profileRow } from "./helpers";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
const { Alert } = require("react-native");

const crewsRow = (over: Record<string, unknown> = {}) => ({
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [
    { user_id: "user-1", handle: "tester", avatar_path: null, role: "owner", live: false },
    { user_id: "user-2", handle: "mate", avatar_path: null, role: "member", live: true },
  ],
  ...over,
});

beforeEach(() => pendingInvite.set(null));

async function mount(backend: ReturnType<typeof makeBackend>) {
  const shell = makeShell(backend);
  await render(<ShellApp shell={shell} />);
  return shell;
}

// The app opens on the Map, so tests about the Crews screen switch to it first.
async function mountOnCrews(backend: ReturnType<typeof makeBackend>) {
  const shell = await mount(backend);
  const tabs = await screen.findAllByText("Crews");
  await fireEvent.press(tabs[0]!);
  return shell;
}

describe("signed out", () => {
  it("shows the welcome screen with invite and sign in", async () => {
    await mount(makeBackend(null));
    expect(await screen.findByText("I have an invite")).toBeTruthy();
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.getByText(/obey all laws/i)).toBeTruthy();
  });

  it("walks from an invite code to account creation and registers with the right payload", async () => {
    const backend = makeBackend(null, {
      "referral.check_invite": () => "valid",
      "fn.register": () => ({ status: "confirmed" }),
    });
    await mount(backend);
    await fireEvent.press(await screen.findByText("I have an invite"));
    await fireEvent.changeText(await screen.findByTestId("invite-code"), "abc234def567");
    await fireEvent.press(screen.getByTestId("invite-continue"));

    expect(await screen.findByText("Create your account")).toBeTruthy();
    expect(backend.calls[0]).toEqual({ name: "referral.check_invite", args: { p_code: "ABC234DEF567" } });

    await fireEvent.changeText(screen.getByTestId("create-handle"), "newdriver");
    await fireEvent.changeText(screen.getByTestId("create-email"), "new@example.test");
    await fireEvent.changeText(screen.getByTestId("create-password"), "longenough1");
    // The button stays off until the terms and age boxes are ticked.
    expect(screen.getByTestId("create-submit").props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(screen.getByTestId("create-adult"));
    await fireEvent.press(screen.getByTestId("create-terms"));
    await fireEvent.press(screen.getByTestId("create-submit"));

    await waitFor(() => expect(backend.invoked.length).toBe(1));
    expect(backend.invoked[0]).toEqual({
      name: "register",
      body: { invite_code: "ABC234DEF567", handle: "newdriver", email: "new@example.test", password: "longenough1", terms_version: "v1", age_confirmed: true },
    });
    await waitFor(() => expect(backend.auth.signIn).toHaveBeenCalledWith("new@example.test", "longenough1"));
  });

  it("shows the invite expired screen for a bad invite", async () => {
    const backend = makeBackend(null, { "referral.check_invite": () => "expired" });
    await mount(backend);
    await fireEvent.press(await screen.findByText("I have an invite"));
    await fireEvent.changeText(await screen.findByTestId("invite-code"), "ABC234DEF567");
    await fireEvent.press(screen.getByTestId("invite-continue"));
    expect(await screen.findByText("Invite not available")).toBeTruthy();
    expect(screen.getByText(/expired/i)).toBeTruthy();
  });

  it("validates the account form before calling the server", async () => {
    const backend = makeBackend(null, { "referral.check_invite": () => "valid", "fn.register": () => ({ status: "check_email" }) });
    await mount(backend);
    await fireEvent.press(await screen.findByText("I have an invite"));
    await fireEvent.changeText(await screen.findByTestId("invite-code"), "ABC234DEF567");
    await fireEvent.press(screen.getByTestId("invite-continue"));
    await screen.findByText("Create your account");
    await fireEvent.changeText(screen.getByTestId("create-handle"), "Ab");
    await fireEvent.changeText(screen.getByTestId("create-email"), "nope");
    await fireEvent.changeText(screen.getByTestId("create-password"), "short");
    await fireEvent.press(screen.getByTestId("create-adult"));
    await fireEvent.press(screen.getByTestId("create-terms"));
    await fireEvent.press(screen.getByTestId("create-submit"));
    expect(await screen.findByText(/3 to 20 characters/)).toBeTruthy();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(backend.invoked.length).toBe(0);
  });

  it("signs in with email and password", async () => {
    const backend = makeBackend(null);
    await mount(backend);
    await fireEvent.press(await screen.findByText("Sign in"));
    await fireEvent.changeText(await screen.findByTestId("signin-email"), "me@example.test");
    await fireEvent.changeText(screen.getByTestId("signin-password"), "longenough1");
    await fireEvent.press(screen.getByTestId("signin-submit"));
    await waitFor(() => expect(backend.auth.signIn).toHaveBeenCalledWith("me@example.test", "longenough1"));
  });

  it("shows a suspended notice after a suspended sign out", async () => {
    const backend = makeBackend("user-1", { "accounts.my_profile": () => [profileRow({ status: "suspended" })] });
    await mount(backend);
    expect(await screen.findByText("This account has been suspended.")).toBeTruthy();
  });
});

describe("signed in", () => {
  const signedIn = (extra: Record<string, (a: any) => unknown> = {}) =>
    makeBackend("user-1", {
      "accounts.my_profile": () => [profileRow()],
      "crews.list_my_crews": () => [crewsRow()],
      "leaderboard.weekly_top_speed": () => [
        { rank: 1, user_id: "user-2", handle: "mate", avatar_path: null, top_speed_kmh: 183.6, set_on: "2025-10-08" },
        { rank: 2, user_id: "user-1", handle: "tester", avatar_path: null, top_speed_kmh: 120, set_on: "2025-10-07" },
      ],
      "referral.list_my_invites": () => [],
      "crews.set_selected_crews": () => null,
      ...extra,
    });

  it("opens on the map with the tab bar, and Crews lists the crews with live counts", async () => {
    await mountOnCrews(signedIn());
    expect(await screen.findByText("Night Cruisers")).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();
    expect(screen.getByText(/1 live/)).toBeTruthy();
    for (const tab of ["Map", "Crews", "Board", "Me"]) expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
  });

  it("shows an empty state with create and join when there are no crews", async () => {
    await mountOnCrews(signedIn({ "crews.list_my_crews": () => [] }));
    expect(await screen.findByText("No crews yet")).toBeTruthy();
    expect(screen.getByTestId("crews-create")).toBeTruthy();
    expect(screen.getByTestId("crews-join")).toBeTruthy();
  });

  it("toggling a crew switches it on or off and saves the selection", async () => {
    const backend = signedIn();
    await mountOnCrews(backend);
    await screen.findByText("Night Cruisers");
    const toggle = screen.getByLabelText("Show Night Cruisers");
    await fireEvent(toggle, "valueChange", false);
    await waitFor(() => expect(backend.calls.some((c) => c.name === "crews.set_selected_crews" && JSON.stringify(c.args) === JSON.stringify({ p_crew_ids: [] }))).toBe(true));
  });

  it("creates a crew with the typed name", async () => {
    const backend = signedIn({ "crews.create_crew": () => [{ id: "crew-2", link_code: "ABCDEFGH23456789" }] });
    await mountOnCrews(backend);
    await fireEvent.press(await screen.findByTestId("crews-create"));
    await fireEvent.changeText(await screen.findByTestId("crew-name"), "Weekend Run");
    await fireEvent.press(screen.getByTestId("crew-create-submit"));
    await waitFor(() => expect(backend.calls.find((c) => c.name === "crews.create_crew")?.args).toEqual({ p_name: "Weekend Run", p_description: null }));
  });

  it("shows the weekly board in km/h with the disclaimer, and highlights you", async () => {
    await mount(signedIn());
    await screen.findByText("Night Cruisers");
    await fireEvent.press(screen.getAllByText("Board")[0]!);
    expect(await screen.findByText("Top speed")).toBeTruthy();
    expect(await screen.findByText("@mate")).toBeTruthy();
    expect(screen.getByText(/^184/)).toBeTruthy();
    expect(screen.getByText("@tester")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText(/Resets Monday/)).toBeTruthy();
    expect(screen.getByText(/obey all laws/i)).toBeTruthy();
  });

  it("shows an empty board when nobody has driven this week", async () => {
    await mount(signedIn({ "leaderboard.weekly_top_speed": () => [] }));
    await screen.findByText("Night Cruisers");
    await fireEvent.press(screen.getAllByText("Board")[0]!);
    expect(await screen.findByText("No sessions this week")).toBeTruthy();
  });

  it("shows the profile, the Share invite menu item from the referral module, and sign out", async () => {
    const backend = signedIn();
    await mount(backend);
    await screen.findByText("Night Cruisers");
    await fireEvent.press(screen.getAllByText("Me")[0]!);
    expect(await screen.findByText("@tester")).toBeTruthy();
    expect(screen.getByText("Share invite")).toBeTruthy();
    expect(screen.getByText("Devices")).toBeTruthy();
    expect(screen.getByText("Delete account")).toBeTruthy();
  });

  it("the map tab shows the Go live button, and the sheet lists crews with the disclaimer", async () => {
    await mount(signedIn());
    await screen.findByText("Night Cruisers");
    await fireEvent.press(screen.getAllByText("Map")[0]!);
    expect(await screen.findByTestId("map-view")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("golive-button"));
    expect(await screen.findByText("Pick who can see you. They see your position and your top speed after the session. Stop any time.")).toBeTruthy();
    expect(screen.getByTestId("golive-crew-Night Cruisers")).toBeTruthy();
    expect(screen.getAllByText(/obey all laws/i).length).toBeGreaterThan(0);
  });

  it("removing a module removes its tab with nothing else affected", async () => {
    const { createShell } = require("@rdv/core");
    const { config } = require("./helpers");
    const backend = signedIn();
    const shell = createShell({ ...config, flags: { leaderboard: false } }, backend);
    const { modules } = require("../src/modules");
    for (const m of modules) m.register(shell);
    await render(<ShellApp shell={shell} />);
    await screen.findByText("Night Cruisers");
    expect(screen.queryAllByText("Board").length).toBe(0);
    expect(screen.getAllByText("Map").length).toBeGreaterThan(0);
  });
});


describe("password reset links", () => {
  const link = "rdvgarage://reset#access_token=a.b.c&refresh_token=r1&type=recovery";

  beforeEach(() => {
    mockStore.clear();
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  it("ignores a reset link this phone never asked for, and does not start a session from it", async () => {
    const backend = makeBackend(null);
    const shell = await mount(backend);
    await screen.findByText("I have an invite");
    await act(async () => shell.dispatchLink(link));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Reset link not requested here", expect.any(String)));
    expect(backend.auth.startRecovery).not.toHaveBeenCalled();
  });

  it("accepts the link after a reset was requested here, then opens the new password screen", async () => {
    const backend = makeBackend("user-1", { "accounts.my_profile": () => [profileRow()], "crews.list_my_crews": () => [] });
    const shell = await mountOnCrews(backend);
    await screen.findByText("No crews yet");
    mockStore.set("rdv.reset.requested", String(Date.now()));
    await act(async () => shell.dispatchLink(link));
    await waitFor(() => expect(backend.auth.startRecovery).toHaveBeenCalledWith("a.b.c", "r1"));
    expect(await screen.findByText("Choose a new password")).toBeTruthy();
  });

  it("does not accept a stale request", async () => {
    const backend = makeBackend(null);
    const shell = await mount(backend);
    await screen.findByText("I have an invite");
    mockStore.set("rdv.reset.requested", String(Date.now() - 2 * 60 * 60 * 1000));
    await act(async () => shell.dispatchLink(link));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(backend.auth.startRecovery).not.toHaveBeenCalled();
  });

  it("tells the person when their other devices could not be signed out", async () => {
    const { AppError } = require("@rdv/core");
    const backend = makeBackend("user-1", { "accounts.my_profile": () => [profileRow()], "crews.list_my_crews": () => [] });
    (backend.auth.completePasswordReset as jest.Mock).mockRejectedValueOnce(new AppError("revoke_failed"));
    const shell = await mountOnCrews(backend);
    await screen.findByText("No crews yet");
    mockStore.set("rdv.reset.requested", String(Date.now()));
    await act(async () => shell.dispatchLink(link));
    const field = await screen.findByLabelText("New password").catch(() => null);
    void field;
    await fireEvent.changeText(await screen.findByDisplayValue(""), "a-long-enough-pass");
    await fireEvent.press(await screen.findByText("Set password"));
    expect(await screen.findByText(/couldn't sign out your other devices/i)).toBeTruthy();
    expect(screen.getByText("Password updated.")).toBeTruthy();
  });
});

describe("leaderboard crew switching", () => {
  it("never shows another crew's rows after switching", async () => {
    let releaseA!: (rows: unknown[]) => void;
    const backend = makeBackend("user-1", {
      "accounts.my_profile": () => [profileRow()],
      "crews.list_my_crews": () => [crewsRow({ id: "crew-a", name: "Alpha" }), crewsRow({ id: "crew-b", name: "Bravo" })],
      "leaderboard.weekly_top_speed": (args: any) =>
        args.p_crew === "crew-a"
          ? new Promise((resolve) => (releaseA = resolve))
          : [{ rank: 1, user_id: "u2", handle: "bravodriver", avatar_path: null, top_speed_kmh: 150, set_on: "2025-10-08" }],
    });
    await mountOnCrews(backend);
    await screen.findByText("Alpha");
    await fireEvent.press(screen.getAllByText("Board")[0]!);
    await screen.findByText("Top speed");
    await fireEvent.press(await screen.findByTestId("board-crew-Bravo"));
    expect(await screen.findByText("@bravodriver")).toBeTruthy();
    // Alpha's slow answer arrives last and must be ignored.
    await act(async () => releaseA([{ rank: 1, user_id: "u9", handle: "alphadriver", avatar_path: null, top_speed_kmh: 200, set_on: "2025-10-08" }]));
    expect(screen.queryByText("@alphadriver")).toBeNull();
    expect(screen.getByText("@bravodriver")).toBeTruthy();
  });
});

describe("sign out and cold start", () => {
  it("clears the previous account's crews, live state, and positions on sign out", async () => {
    const backend = makeBackend("user-1", { "accounts.my_profile": () => [profileRow()], "crews.list_my_crews": () => [crewsRow()] });
    const shell = await mount(backend);
    await screen.findByText("Night Cruisers");
    shell.live.set({ live: true, sessionId: "s1", crewIds: ["crew-1"] });
    shell.locationStream.publish({ userId: "user-2", crewIds: ["crew-1"], lat: 1, lng: 2, heading: null, ts: Date.now() });
    await act(async () => backend.setUser(null));
    expect(await screen.findByText("I have an invite")).toBeTruthy();
    expect(shell.crewContext.store.get()).toEqual({ loaded: false, crews: [], selected: [] });
    expect(shell.live.get()).toEqual({ live: false, sessionId: null, crewIds: [] });
    expect(shell.locationStream.store.get()).toEqual({});
  });

  it("delivers a reset link opened at launch to the new password screen once the signed-in screens exist", async () => {
    mockStore.set("rdv.reset.requested", String(Date.now()));
    const backend = makeBackend(null, { "accounts.my_profile": () => [profileRow()], "crews.list_my_crews": () => [] });
    (backend.auth.startRecovery as jest.Mock).mockImplementation(async () => backend.setUser("user-1"));
    const shell = await mount(backend);
    await screen.findByText("I have an invite");
    await act(async () => shell.dispatchLink("rdvgarage://reset#access_token=a.b.c&refresh_token=r1&type=recovery"));
    expect(await screen.findByText("Choose a new password")).toBeTruthy();
  });
});


describe("offline at launch", () => {
  it("shows a waiting screen instead of signing the person out, then recovers on its own", async () => {
    jest.useFakeTimers();
    try {
      const { AppError } = require("@rdv/core");
      let attempts = 0;
      const backend = makeBackend("user-1", {
        "accounts.my_profile": () => {
          if (++attempts === 1) throw new AppError("network");
          return [profileRow()];
        },
        "crews.list_my_crews": () => [crewsRow()],
      });
      const shell = await mount(backend);
      expect(await screen.findByText("Can't reach RDV Garage")).toBeTruthy();
      expect(shell.session.get().status).toBe("offline");
      expect(backend.auth.signOut).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(5100));
      expect(await screen.findByText("Night Cruisers")).toBeTruthy();
      expect(shell.session.get().status).toBe("signedIn");
    } finally {
      jest.useRealTimers();
    }
  });
});
