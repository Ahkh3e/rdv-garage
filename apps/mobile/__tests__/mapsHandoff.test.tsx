import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { ShellApp } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

const canOpen = jest.spyOn(Linking, "canOpenURL");
const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

const backend = () =>
  makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
  });

describe("Me, Maps app", () => {
  it("stores the choice on the device and Directions then opens that app", async () => {
    canOpen.mockResolvedValue(true);
    const shell = makeShell(backend());
    await render(<ShellApp shell={shell} />);
    await fireEvent.press((await screen.findAllByText("Me"))[0]!);
    await fireEvent.press(await screen.findByTestId("me-maps-app"));
    await fireEvent.press(await screen.findByTestId("maps-app-google"));
    await waitFor(() => expect(mockStore.get("rdv.maps.app")).toBe("google"));

    await shell.handoff.openDirections({ lat: 43.65, lng: -79.38, label: "Meet" });
    expect(open).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=43.65,-79.38");
  });
});
