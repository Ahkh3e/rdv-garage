import { act, render, screen } from "@testing-library/react-native";
import { ShellApp } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

const { cameraApi } = require("@maplibre/maplibre-react-native");

const crewsRow = {
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [{ user_id: "user-1", handle: "tester", avatar_path: null, role: "owner", live: false }],
};

async function mount() {
  const backend = makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crewsRow],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "places.list_pins": () => [],
  });
  const shell = makeShell(backend);
  await render(<ShellApp shell={shell} />);
  await screen.findByTestId("map-view");
  await act(async () => undefined);
  return shell;
}

beforeEach(() => Object.values(cameraApi).forEach((fn: any) => fn.mockReset()));

describe("far camera moves", () => {
  it("level the camera, jump with a north bearing, then restore the pitch", async () => {
    const shell = await mount();
    await act(async () => shell.mapBridge.flyTo({ lat: 45.5, lng: -73.6 }, 14));
    expect(cameraApi.setStop).toHaveBeenCalledWith({ pitch: 0, duration: 0 });
    expect(cameraApi.jumpTo).toHaveBeenCalledWith({ center: [-73.6, 45.5], zoom: 14, pitch: 0, bearing: 0 });
    expect(cameraApi.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-73.6, 45.5], bearing: 0, duration: 700 }));
  });

  it("still restores the pitch and reports the error when a step rejects", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const shell = await mount();
    cameraApi.setStop.mockRejectedValueOnce(new Error("native"));
    await act(async () => shell.mapBridge.flyTo({ lat: 45.5, lng: -73.6 }, 14));
    expect(cameraApi.jumpTo).not.toHaveBeenCalled();
    expect(cameraApi.easeTo).toHaveBeenCalledWith(expect.objectContaining({ pitch: expect.any(Number), duration: 700 }));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("lets a newer far move supersede an older one, restoring the pitch once", async () => {
    const shell = await mount();
    const releases: (() => void)[] = [];
    cameraApi.setStop.mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)));
    await act(async () => {
      shell.mapBridge.flyTo({ lat: 45.5, lng: -73.6 }, 14);
      shell.mapBridge.flyTo({ lat: 49.2, lng: -123.1 }, 12);
    });
    await act(async () => releases.forEach((release) => release()));
    expect(cameraApi.jumpTo).toHaveBeenCalledTimes(1);
    expect(cameraApi.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-123.1, 49.2], zoom: 12 }));
    expect(cameraApi.easeTo).toHaveBeenCalledTimes(1);
    expect(cameraApi.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [-123.1, 49.2], duration: 700 }));
  });
});
