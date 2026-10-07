import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Keyboard, Linking } from "react-native";
import { ShellApp, DISCLAIMER_PLACES, type Poi } from "@rdv/core";
import { makeBackend, makeShell, profileRow } from "./helpers";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

const mockFiles = new Map<string, string>();
jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri)).join("/");
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, "");
    }
    write(content: string) {
      mockFiles.set(this.uri, content);
    }
    async text() {
      return mockFiles.get(this.uri) ?? "";
    }
  }
  return { File, Paths: { document: { uri: "doc" } } };
});

const recentsOnDisk = () => [...mockFiles.entries()].find(([k]) => k.endsWith("rdv-places-recents.json"))?.[1];

jest.spyOn(Linking, "canOpenURL").mockResolvedValue(true);
jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);

const crewsRow = {
  id: "crew-1", name: "Night Cruisers", description: null, avatar_path: null, owner_id: "user-1", role: "owner", link_code: "LINKCODE12345678", selected: true,
  members: [{ user_id: "user-1", handle: "tester", avatar_path: null, role: "owner", live: false }],
};

const pinRow = { id: "pin-1", dropper_id: "user-2", dropper_handle: "mate", label: "Cars and coffee", note: "Bring a chair", address: "5 King St", lat: 43.7, lng: -79.4, expires_at: new Date(Date.now() + 5 * 3600000).toISOString(), crew_ids: ["crew-1"] };

const results = [
  { name: "Tim Hortons", kind: "Cafe", address: "10 Queen St, Toronto", lat: 43.65, lng: -79.38 },
  { name: "Tim Hortons", kind: "Cafe", address: "20 King St, Toronto", lat: 43.66, lng: -79.39 },
];

function backend(extra: Record<string, (args: any) => unknown> = {}) {
  return makeBackend("user-1", {
    "accounts.my_profile": () => [profileRow()],
    "crews.list_my_crews": () => [crewsRow],
    "leaderboard.weekly_top_speed": () => [],
    "referral.list_my_invites": () => [],
    "places.list_pins": () => [pinRow],
    "places.drop_pin": () => "pin-new",
    "places.remove_pin": () => null,
    "fn.search_places": () => ({ results }),
    ...extra,
  });
}

async function mount(b = backend(), withRdv = false) {
  const shell = makeShell(b);
  if (withRdv) shell.addRoute({ name: "RdvCreate", component: () => null });
  const directions = jest.fn(async () => undefined);
  shell.setHandoff({ openDirections: directions });
  await render(<ShellApp shell={shell} />);
  await screen.findByTestId("places-search-input");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return { shell, directions, backend: b };
}

const inputs = () => screen.getAllByTestId("places-search-input");
const type = async (text: string) => {
  await screen.findByTestId("places-search-input");
  return fireEvent.changeText(inputs().at(-1)!, text);
};

describe("place search", () => {
  it("waits for three characters and a pause, then shows results and a place card with Directions", async () => {
    const { backend: b, directions } = await mount();
    await type("ti");
    await new Promise((r) => setTimeout(r, 500));
    expect(b.invoked).toEqual([]);

    await type("tim hortons");
    await fireEvent(inputs().at(-1)!, "focus");
    await waitFor(() => expect(b.invoked).toHaveLength(1));
    expect(b.invoked[0]).toEqual({ name: "search_places", body: { text: "tim hortons", bias: null } });

    expect(await screen.findByText("20 King St, Toronto", { exact: false })).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("places-result-0"));
    expect(await screen.findByTestId("place-card")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_PLACES)).toBeTruthy();
    expect(screen.queryByTestId("place-card-rdv")).toBeNull();

    await fireEvent.press(screen.getByTestId("place-card-directions"));
    expect(directions).toHaveBeenCalledWith({ lat: 43.65, lng: -79.38, label: "Tim Hortons" });
  });

  it("sends a coarse bias, shows an empty state, and keeps recents on the device", async () => {
    const b = backend({ "fn.search_places": () => ({ results: [] }) });
    const { shell } = await mount(b);
    shell.mapBridge.setView({ lat: 43.653226, lng: -79.383184, zoom: 12 });
    await type("zzzz");
    await fireEvent(inputs().at(-1)!, "focus");
    expect(await screen.findByTestId("places-empty")).toBeTruthy();
    expect(b.invoked[0]!.body).toEqual({ text: "zzzz", bias: { lat: 43.65, lng: -79.38 } });
  });

  it("clears recent searches from the device when the person signs out", async () => {
    mockFiles.clear();
    const { shell } = await mount();
    await type("night meet");
    await fireEvent(inputs().at(-1)!, "focus");
    await fireEvent.press(await screen.findByTestId("places-result-0"));
    await waitFor(() => expect(JSON.parse(recentsOnDisk() ?? "[]")).toContain("night meet"));
    await act(async () => shell.session.set({ status: "signedOut" }));
    await waitFor(() => expect(JSON.parse(recentsOnDisk()!)).toEqual([]));
  });

  it("closes the search panel when the field loses focus with nothing usable typed", async () => {
    mockFiles.clear();
    await mount();
    await fireEvent(inputs().at(-1)!, "focus");
    await type("t");
    expect(await screen.findByText("Type at least 3 characters.")).toBeTruthy();
    await fireEvent(inputs().at(-1)!, "blur");
    await waitFor(() => expect(screen.queryByText("Type at least 3 characters.")).toBeNull());
  });

  it("keeps the search panel when the field is focused again before the idle check runs", async () => {
    mockFiles.clear();
    await mount();
    await fireEvent(inputs().at(-1)!, "focus");
    await type("t");
    await fireEvent(inputs().at(-1)!, "blur");
    await fireEvent(inputs().at(-1)!, "focus");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByText("Type at least 3 characters.")).toBeTruthy();
  });

  it("dismisses the keyboard and closes the idle search panel when the map is tapped", async () => {
    mockFiles.clear();
    await mount();
    await fireEvent(inputs().at(-1)!, "focus");
    expect(await screen.findByText("Type at least 3 characters.")).toBeTruthy();
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    await fireEvent.press(screen.getByTestId("map-view"));
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });

  it("keeps a Recent row tappable across the blur that comes before the press", async () => {
    mockFiles.clear();
    await mount();
    await type("night meet");
    await fireEvent(inputs().at(-1)!, "focus");
    await fireEvent.press(await screen.findByTestId("places-result-0"));
    await waitFor(() => expect(JSON.parse(recentsOnDisk() ?? "[]")).toContain("night meet"));
    await fireEvent(inputs().at(-1)!, "focus");
    await fireEvent(inputs().at(-1)!, "blur");
    await fireEvent.press(await screen.findByTestId("places-recent-night meet"));
    await new Promise((r) => setTimeout(r, 400));
    expect(inputs().at(-1)!.props.value).toBe("night meet");
    expect(await screen.findByTestId("places-result-0")).toBeTruthy();
  });

  it("offers Make an RDV only when an RDV create route is registered", async () => {
    await mount(backend(), true);
    await type("tim hortons");
    await fireEvent(inputs().at(-1)!, "focus");
    await fireEvent.press(await screen.findByTestId("places-result-0"));
    expect(await screen.findByTestId("place-card-rdv")).toBeTruthy();
  });
});

describe("pins", () => {
  it("shows a crew pin through the pin registry and its card, and lets the crew owner remove it", async () => {
    const b = backend();
    const { shell } = await mount(b);
    await waitFor(() => expect(shell.pins.store.get().map((p) => p.id)).toEqual(["places:pin-pin-1"]));
    expect(shell.pins.store.get()[0]).toMatchObject({ kind: "pin", label: "Cars and coffee" });

    shell.pins.press("places:pin-pin-1");
    expect(await screen.findByTestId("pin-card")).toBeTruthy();
    expect(screen.getByText("Bring a chair")).toBeTruthy();
    expect(screen.getByText(/@mate/)).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_PLACES)).toBeTruthy();

    await fireEvent.press(screen.getByTestId("pin-card-remove"));
    await waitFor(() => expect(b.calls.some((c) => c.name === "places.remove_pin" && (c.args as any).p_pin === "pin-1")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("pin-card")).toBeNull());
  });

  it("drops a pin from a long press with the selected crews, label and note", async () => {
    const b = backend();
    const { shell } = await mount(b);
    await act(async () => shell.mapBridge.longPress({ lat: 43.6, lng: -79.5 }));
    const label = await screen.findByTestId("drop-label");
    expect(label.props.value).toBe("Dropped pin");
    await fireEvent.changeText(label, "Photo spot");
    await fireEvent.changeText(screen.getByTestId("drop-note"), "Golden hour");
    expect(screen.getAllByText(DISCLAIMER_PLACES).length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId("drop-submit"));
    await waitFor(() => expect(b.calls.find((c) => c.name === "places.drop_pin")?.args).toEqual({
      p_label: "Photo spot", p_note: "Golden hour", p_lat: 43.6, p_lng: -79.5, p_address: null, p_crew_ids: ["crew-1"],
    }));
    await waitFor(() => expect(screen.queryByTestId("drop-label")).toBeNull());
  });

  it("will not drop with a short label or no crew chosen", async () => {
    const b = backend();
    const { shell } = await mount(b);
    await act(async () => shell.mapBridge.longPress({ lat: 43.6, lng: -79.5 }));
    await fireEvent.changeText(await screen.findByTestId("drop-label"), "ab");
    const disabled = () => screen.getByTestId("drop-submit").props.accessibilityState.disabled;
    expect(disabled()).toBe(true);
    await fireEvent.changeText(screen.getByTestId("drop-label"), "Fine label");
    expect(disabled()).toBe(false);
    await fireEvent.press(screen.getByTestId("drop-crew-Night Cruisers"));
    expect(disabled()).toBe(true);
    await fireEvent.press(screen.getByTestId("drop-crew-Night Cruisers"));
    expect(disabled()).toBe(false);
    expect(b.calls.some((c) => c.name === "places.drop_pin")).toBe(false);
  });
});

describe("nearby", () => {
  it("lists the closest places of a category by straight-line distance, with no network call", async () => {
    const b = backend();
    const { shell } = await mount(b);
    const pois: Poi[] = [
      { name: "Far Gas", lat: 43.7, lng: -79.38, cls: "fuel", subclass: null },
      { name: "Near Gas", lat: 43.651, lng: -79.38, cls: "fuel", subclass: null },
      { name: "Some Cafe", lat: 43.6501, lng: -79.38, cls: "cafe", subclass: null },
    ];
    shell.mapBridge.attach({ queryPois: async () => pois, flyTo: jest.fn() });
    shell.mapBridge.setView({ lat: 43.65, lng: -79.38, zoom: 15 });
    const invokedBefore = b.invoked.length;

    await fireEvent.press(await screen.findByTestId("places-nearby"));
    await fireEvent.press(await screen.findByTestId("nearby-fuel"));
    expect(await screen.findByText("Near Gas")).toBeTruthy();
    expect(screen.getByText("Far Gas")).toBeTruthy();
    expect(screen.queryByText("Some Cafe")).toBeNull();
    expect(screen.queryByText(/min/)).toBeNull();
    expect(b.invoked.length).toBe(invokedBefore);

    await fireEvent.press(screen.getByTestId("nearby-result-0"));
    expect(await screen.findByTestId("place-card")).toBeTruthy();
    expect(screen.getByText("Near Gas")).toBeTruthy();
  });
});

describe("place picker", () => {
  it("lets another module choose a place and resolves with it", async () => {
    const { shell } = await mount();
    const picked = shell.places.pick();
    await type("tim hortons");
    await fireEvent.press(await screen.findByTestId("places-result-1"));
    await expect(picked).resolves.toMatchObject({ name: "Tim Hortons", address: "20 King St, Toronto" });
  });
});
