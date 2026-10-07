import { createShell, type Shell } from "@rdv/core";
import { startNotifications, newlyLive, REUSE_AFTER_MS } from "../../../packages/notifications/src";
import type { Notifier } from "../../../packages/notifications/src/notifier";
import { makeBackend, config } from "./helpers";

jest.mock("expo-notifications", () => ({}));
jest.mock("expo-live-activity", () => ({}));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));

function setup(appState = "background") {
  const shell = createShell(config, makeBackend("me")) as Shell;
  shell.session.set({ status: "signedIn", userId: "me", profile: { id: "me", handle: "tester", avatarPath: null, carIcon: "gt" } });
  shell.crewContext.setCrews([
    { id: "c1", name: "Night Cruisers", description: null, avatarPath: null, ownerId: "me", role: "owner", linkCode: null, selected: true, members: [
      { userId: "me", handle: "tester", avatarPath: null, carIcon: "gt", role: "owner", live: true },
      { userId: "u2", handle: "mate", avatarPath: null, carIcon: "gt", role: "member", live: true },
    ] },
  ]);
  shell.crewContext.select(["c1"]);
  const calls: string[] = [];
  const notifier: Notifier = {
    ensurePermission: jest.fn(async () => true),
    showLive: jest.fn(async () => void calls.push("live")),
    hideLive: jest.fn(async () => void calls.push("hide")),
    showFriend: jest.fn(async (_id, handle, crew) => void calls.push(`friend:${handle}:${crew ?? "-"}`)),
  };
  let state = appState;
  startNotifications(shell, notifier, () => state);
  const publish = (userId: string, crewIds = ["c1"]) => shell.locationStream.publish({ userId, crewIds, lat: 43.65, lng: -79.38, heading: 0, ts: Date.now() });
  return { shell, notifier, calls, publish, setState: (s: string) => (state = s) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("live notification", () => {
  it("shows a notification that you are live, without naming crews, and removes it when you stop", async () => {
    const { shell, calls } = setup();
    shell.events.emit({ type: "session.started", sessionId: "s1", crewIds: ["c1"] });
    await flush();
    expect(calls).toContain("live");
    expect(calls.join("|")).not.toContain("Night Cruisers");
    shell.events.emit({ type: "session.ended", sessionId: "s1" });
    await flush();
    expect(calls).toContain("hide");
  });

  it("shows the live indicator even when notifications are not allowed", async () => {
    const { shell, notifier } = setup();
    (notifier.ensurePermission as jest.Mock).mockResolvedValue(false);
    shell.events.emit({ type: "session.started", sessionId: "s1", crewIds: ["c1"] });
    await flush();
    expect(notifier.showLive).toHaveBeenCalledTimes(1);
  });

  it("clears anything left behind at startup, and when the account is deleted or suspended", async () => {
    const { shell, notifier } = setup();
    expect(notifier.hideLive).toHaveBeenCalledTimes(1);
    shell.events.emit({ type: "account.deleted" });
    shell.events.emit({ type: "account.suspended" });
    await flush();
    expect(notifier.hideLive).toHaveBeenCalledTimes(3);
  });
});

describe("friend goes live", () => {
  it("notifies when a crew member appears while you are away from the app", async () => {
    const { calls, publish } = setup("background");
    publish("u2");
    await flush();
    expect(calls).toContain("friend:mate:Night Cruisers");
  });

  it("stays quiet while the app is open, because the map already shows them", async () => {
    const { notifier, publish } = setup("active");
    publish("u2");
    await flush();
    expect(notifier.showFriend).not.toHaveBeenCalled();
  });

  it("does not repeat for a member who is just moving, or for yourself", async () => {
    const { notifier, publish } = setup("background");
    publish("u2");
    publish("u2");
    publish("me");
    await flush();
    expect(notifier.showFriend).toHaveBeenCalledTimes(1);
  });

  it("does not name a crew when the friend shares more than one crew with you", async () => {
    const { shell, calls, publish } = setup("background");
    shell.crewContext.setCrews([
      ...shell.crewContext.store.get().crews,
      { id: "c2", name: "Sunday Meets", description: null, avatarPath: null, ownerId: "me", role: "owner", linkCode: null, selected: true, members: [
        { userId: "me", handle: "tester", avatarPath: null, carIcon: "gt", role: "owner", live: true },
        { userId: "u2", handle: "mate", avatarPath: null, carIcon: "gt", role: "member", live: true },
      ] },
    ]);
    shell.crewContext.select(["c1", "c2"]);
    publish("u2", ["c1", "c2"]);
    await flush();
    expect(calls).toContain("friend:mate:-");
  });

  it("ignores members of crews you have not switched on", async () => {
    const { notifier, publish } = setup("background");
    publish("u2", ["other-crew"]);
    await flush();
    expect(notifier.showFriend).not.toHaveBeenCalled();
  });
});

describe("newlyLive", () => {
  it("only reports someone who was not live a moment ago, and not again within the reuse window", () => {
    const seen = new Map<string, number>();
    const notified = new Map<string, number>();
    const m = [{ userId: "a", crewIds: ["c"] }];
    expect(newlyLive(m, seen, notified, 0, null)).toHaveLength(1);
    expect(newlyLive(m, seen, notified, 1000, null)).toHaveLength(0);
    notified.set("a", 0);
    expect(newlyLive([], seen, notified, 2000, null)).toHaveLength(0);
    expect(newlyLive(m, seen, notified, 3000, null)).toHaveLength(0);
    expect(newlyLive([], seen, notified, 4000, null)).toHaveLength(0);
    expect(newlyLive(m, seen, notified, REUSE_AFTER_MS + 5000, null)).toHaveLength(1);
  });
});
