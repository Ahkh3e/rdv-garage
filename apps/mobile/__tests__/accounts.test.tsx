import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ShellApp } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
const { Alert, Share } = require("react-native");
const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

const crew = {
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [{ user_id: "user-1", handle: "tester", avatar_path: null, car_icon: "gt", role: "owner", live: false }],
};

const signedIn = (extra: Record<string, (a: any) => unknown> = {}) =>
  makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crew],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "crews.set_selected_crews": () => null,
    ...extra,
  });

async function openMe(backend: ReturnType<typeof makeBackend>) {
  const shell = makeShell(backend);
  await render(<ShellApp shell={shell} />);
  await fireEvent.press((await screen.findAllByText("Me"))[0]!);
  await screen.findByText("@tester");
  return shell;
}

// Taps the button an Alert offers, as the person would.
function confirmAlert(label: string) {
  const call = alertSpy.mock.calls.at(-1)!;
  const button = ((call[2] ?? []) as { text: string; onPress?: () => unknown }[]).find((b) => b.text === label)!;
  return act(async () => void (await button.onPress?.()));
}

beforeEach(() => alertSpy.mockClear());

describe("account management screens", () => {
  it("changes the password with the current and the new one", async () => {
    const backend = signedIn();
    await openMe(backend);
    await fireEvent.press(screen.getByText("Change password"));
    await fireEvent.changeText(await screen.findByTestId("change-current"), "old-password-1");
    expect(screen.getByTestId("change-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId("change-new"), "brand-new-pass");
    await fireEvent.press(screen.getByTestId("change-submit"));
    await waitFor(() => expect(backend.auth.changePassword).toHaveBeenCalledWith("old-password-1", "brand-new-pass"));
    expect(await screen.findByText("Password changed. Other devices were signed out.")).toBeTruthy();
  });

  it("will not submit a short new password", async () => {
    await openMe(signedIn());
    await fireEvent.press(screen.getByText("Change password"));
    await fireEvent.changeText(await screen.findByTestId("change-current"), "old-password-1");
    await fireEvent.changeText(screen.getByTestId("change-new"), "short");
    expect(screen.getByTestId("change-submit").props.accessibilityState.disabled).toBe(true);
  });

  it("edits the handle, and only offers Save when it has changed", async () => {
    const backend = signedIn({ "accounts.update_profile": () => null });
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-edit"));
    const field = await screen.findByTestId("edit-handle");
    expect(screen.getByTestId("edit-save").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(field, "newname");
    await fireEvent.press(screen.getByTestId("edit-save"));
    await waitFor(() => expect(backend.calls.find((c) => c.name === "accounts.update_profile")?.args).toEqual({ p_handle: "newname" }));
  });

  it("lists devices, signs one out after a confirmation, and signs out all the others", async () => {
    const backend = signedIn();
    (backend.auth.listSessions as jest.Mock).mockResolvedValue([
      { id: "s-now", createdAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-07T00:00:00Z", userAgent: "RDVGarage/1 iPhone", isCurrent: true },
      { id: "s-old", createdAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-09-20T00:00:00Z", userAgent: "RDVGarage/1 Android", isCurrent: false },
    ]);
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-devices"));
    expect(await screen.findByText(/this device/i)).toBeTruthy();
    await fireEvent.press(screen.getByText(/Android/));
    await confirmAlert("Sign out device");
    await waitFor(() => expect(backend.auth.revokeSession).toHaveBeenCalledWith("s-old"));
    await fireEvent.press(await screen.findByText("Sign out all other devices"));
    await waitFor(() => expect(backend.auth.revokeSession).toHaveBeenCalledWith("others"));
  });

  it("creates and shares an invite, shows who joined, and revokes an active one", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    let invites = [
      { id: "i-1", code: "ACTIVECODE123", created_at: "2026-10-07T00:00:00Z", expires_at: new Date(Date.now() + 3600_000).toISOString(), status: "active", joined: [{ handle: "friend", joined_at: "2026-10-07T01:00:00Z" }] },
      { id: "i-2", code: "OLDCODE456789", created_at: "2026-10-05T00:00:00Z", expires_at: "2026-10-06T00:00:00Z", status: "expired", joined: [] },
    ];
    const backend = signedIn({
      "referral.list_my_invites": () => invites,
      "referral.create_invite": () => {
        invites = [{ id: "i-3", code: "NEWCODE111111", created_at: "now", expires_at: new Date(Date.now() + 86400_000).toISOString(), status: "active", joined: [] }, ...invites];
        return [{ code: "NEWCODE111111" }];
      },
      "referral.revoke_invite": () => null,
    });
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-invites"));
    expect(await screen.findByText("ACTIVECODE123")).toBeTruthy();
    expect(screen.getByText("Joined: @friend")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("invite-create"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(JSON.stringify(share.mock.calls[0])).toContain("NEWCODE111111");
    await fireEvent.press(screen.getAllByText("Revoke")[0]!);
    await confirmAlert("Revoke");
    await waitFor(() => expect(backend.calls.find((c) => c.name === "referral.revoke_invite")?.args).toEqual({ p_id: "i-3" }));
    share.mockRestore();
  });

  it("deletes the account only after the handle is typed, then signs out", async () => {
    const backend = signedIn({ "fn.delete-account": () => ({ ok: true }) });
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-delete"));
    const confirm = await screen.findByTestId("delete-confirm");
    expect(screen.getByTestId("delete-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(confirm, "wrong");
    expect(screen.getByTestId("delete-submit").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(confirm, "tester");
    await fireEvent.press(screen.getByTestId("delete-submit"));
    await waitFor(() => expect(backend.invoked.some((i) => i.name === "delete-account")).toBe(true));
    await waitFor(() => expect(backend.auth.signOut).toHaveBeenCalled());
  });

  it("signs out after a confirmation", async () => {
    const backend = signedIn();
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-signout"));
    await confirmAlert("Sign out");
    await waitFor(() => expect(backend.auth.signOut).toHaveBeenCalled());
  });

  it("chooses a car and saves it to the profile", async () => {
    const backend = signedIn({ "accounts.update_profile": () => null });
    await openMe(backend);
    await fireEvent.press(screen.getByTestId("me-car"));
    await fireEvent.press(await screen.findByTestId("car-rally"));
    await waitFor(() => expect(backend.calls.find((c) => c.name === "accounts.update_profile")?.args).toEqual({ p_car_icon: "rally" }));
  });
});
