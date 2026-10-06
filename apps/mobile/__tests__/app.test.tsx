import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShellApp } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

jest.mock("expo-secure-store", () => ({}));

const crewsRow = (over: Record<string, unknown> = {}) => ({
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [
    { user_id: "user-1", handle: "tester", avatar_path: null, role: "owner", live: false },
    { user_id: "user-2", handle: "mate", avatar_path: null, role: "member", live: true },
  ],
  ...over,
});

async function mount(backend: ReturnType<typeof makeBackend>) {
  const shell = makeShell(backend);
  await render(<ShellApp shell={shell} />);
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

  it("opens on Crews with the tab bar and lists the crews with live counts", async () => {
    await mount(signedIn());
    expect(await screen.findByText("Night Cruisers")).toBeTruthy();
    expect(screen.getByText(/2 members/)).toBeTruthy();
    expect(screen.getByText(/1 live/)).toBeTruthy();
    for (const tab of ["Map", "Crews", "Board", "Me"]) expect(screen.getAllByText(tab).length).toBeGreaterThan(0);
  });

  it("shows an empty state with create and join when there are no crews", async () => {
    await mount(signedIn({ "crews.list_my_crews": () => [] }));
    expect(await screen.findByText("No crews yet")).toBeTruthy();
    expect(screen.getByTestId("crews-create")).toBeTruthy();
    expect(screen.getByTestId("crews-join")).toBeTruthy();
  });

  it("toggling a crew switches it on or off and saves the selection", async () => {
    const backend = signedIn();
    await mount(backend);
    await screen.findByText("Night Cruisers");
    const toggle = screen.getByLabelText("Show Night Cruisers");
    await fireEvent(toggle, "valueChange", false);
    await waitFor(() => expect(backend.calls.some((c) => c.name === "crews.set_selected_crews" && JSON.stringify(c.args) === JSON.stringify({ p_crew_ids: [] }))).toBe(true));
  });

  it("creates a crew with the typed name", async () => {
    const backend = signedIn({ "crews.create_crew": () => [{ id: "crew-2", link_code: "ABCDEFGH23456789" }] });
    await mount(backend);
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
    expect(screen.getByText(/@tester\s+\(you\)/)).toBeTruthy();
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
