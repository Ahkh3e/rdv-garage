import { describe, expect, it, vi } from "vitest";
import type { ChannelLike, SessionState } from "@rdv/core";
import { createStore } from "@rdv/core/store";
import { TERMS_VERSION } from "@rdv/core/legal";
import { createChatController, type LocalNotice, type RoomNotifier } from "./controller";
import type { RoomRow } from "./model";

const row = (over: Partial<RoomRow> = {}): RoomRow => ({
  id: "r1", kind: "invite", name: "Late night", description: null, crew_id: null, rdv_id: null, status: "active", role: "member", muted: false,
  can_moderate: false, members: 3, unread: 0, last_message: null, ...over,
});
const inbox = (over: Record<string, unknown> = {}) => ({ room_id: "r1", message_id: "m1", sender_id: "u2", handle: "ace", text: "hello", created_at: "2026-01-01T10:00:00.000Z", ...over });

function setup(rooms: RoomRow[] = [row()], appState = "background", profile: Record<string, unknown> = {}) {
  const handlers = new Map<string, (payload: any) => void>();
  const channel: ChannelLike = {
    on: (event, fn) => void handlers.set(event, fn),
    subscribe: () => undefined, send: async () => undefined, track: async () => undefined, untrack: async () => undefined, unsubscribe: async () => undefined,
  };
  const calls: { name: string; args: unknown }[] = [];
  const channels: string[] = [];
  let list = rooms;
  let hold: Promise<void> | null = null;
  const shown: LocalNotice[] = [];
  const notifier: RoomNotifier = {
    ensurePermission: vi.fn(async () => true),
    show: async (n) => void shown.push(n),
    onOpen: () => () => undefined,
  };
  const session = createStore<SessionState>({ status: "signedIn", userId: "me", profile: { id: "me", handle: "tester", avatarPath: null, carIcon: "gt", ...profile } });
  const navigate = vi.fn();
  const shell = {
    session,
    navigate,
    events: { emit: vi.fn(), on: () => () => undefined },
    backend: {
      channel: (name: string) => (channels.push(name), channel),
      async rpc(_schema: string, name: string, args: unknown) {
        calls.push({ name, args });
        if (name === "list_rooms") {
          const snapshot = list;
          if (hold) await hold;
          return snapshot;
        }
        if (name === "list_messages") return [];
        if (name === "send_message") return { id: "sent1", sender_id: "me", handle: "tester", body: (args as any).p_body, created_at: "2026-01-01T10:00:01.000Z" };
        return null;
      },
    },
  } as any;
  let current = appState;
  const controller = createChatController(shell, { notifier, appState: () => current, retryMs: 1 });
  const holdRefresh = () => {
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    return () => {
      hold = null;
      release();
    };
  };
  return { session, holdRefresh, controller, handlers, calls, shown, notifier, navigate, channels, setRooms: (r: RoomRow[]) => (list = r), setApp: (s: string) => (current = s) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("chat controller", () => {
  it("loads rooms and listens on the person's own inbox channel", async () => {
    const t = setup();
    const stop = t.controller.start();
    await flush();
    expect(t.channels).toEqual(["inbox:me"]);
    expect(t.controller.state.get().rooms.map((r) => r.id)).toEqual(["r1"]);
    stop();
    expect(t.controller.state.get().rooms).toEqual([]);
  });

  it("adds a live message, counts it unread, and notifies with handle, room and text while away", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    t.handlers.get("message")!(inbox());
    await flush();
    const room = t.controller.state.get().rooms[0]!;
    expect(room.unread).toBe(1);
    expect(room.lastMessage!.body).toBe("hello");
    expect(t.shown).toEqual([{ roomId: "r1", title: "@ace in Late night", body: "hello" }]);
  });

  it("does not notify for a muted room, your own message, or the room on screen in the foreground", async () => {
    const t = setup([row({ muted: true })], "active");
    t.controller.start();
    await flush();
    t.handlers.get("message")!(inbox());
    await flush();
    expect(t.shown).toEqual([]);
    expect(t.controller.state.get().rooms[0]!.unread).toBe(1);

    const u = setup([row()], "active");
    u.controller.start();
    await flush();
    u.handlers.get("message")!(inbox({ sender_id: "me" }));
    u.controller.setViewing("r1");
    u.handlers.get("message")!(inbox({ message_id: "m2" }));
    await flush();
    expect(u.shown).toEqual([]);
    expect(u.controller.state.get().rooms[0]!.unread).toBe(0);
    u.setApp("background");
    u.handlers.get("message")!(inbox({ message_id: "m3" }));
    await flush();
    expect(u.shown).toHaveLength(1);
  });

  it("fetches the room list when a message arrives for a room it does not know", async () => {
    const t = setup([]);
    t.controller.start();
    await flush();
    t.setRooms([row({ id: "r9", name: "New one" })]);
    t.handlers.get("message")!(inbox({ room_id: "r9" }));
    await flush();
    expect(t.shown).toEqual([{ roomId: "r9", title: "@ace in New one", body: "hello" }]);
  });

  it("refreshes the list on room_changed and drops a deleted message", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    t.handlers.get("message")!(inbox());
    await flush();
    const before = t.calls.filter((c) => c.name === "list_rooms").length;
    t.handlers.get("room_changed")!({ room_id: "r1" });
    t.handlers.get("message_deleted")!({ room_id: "r1", message_id: "m1" });
    await flush();
    expect(t.controller.state.get().messages.r1).toEqual([]);
    expect(t.calls.filter((c) => c.name === "list_rooms").length).toBeGreaterThan(before);
  });

  it("sends a message through the server and shows it once even when the inbox echoes it", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    await t.controller.send("r1", "hi there");
    t.handlers.get("message")!(inbox({ message_id: "sent1", sender_id: "me", handle: "tester", text: "hi there" }));
    await flush();
    expect(t.calls.find((c) => c.name === "send_message")!.args).toEqual({ p_room: "r1", p_body: "hi there" });
    expect(t.controller.state.get().messages.r1!.map((m) => m.id)).toEqual(["sent1"]);
    expect(t.controller.state.get().rooms[0]!.unread).toBe(0);
    expect(t.shown).toEqual([]);
  });

  it("marks a room read on the server when it is opened", async () => {
    const t = setup([row({ unread: 3 })]);
    t.controller.start();
    await flush();
    t.controller.setViewing("r1");
    await flush();
    expect(t.controller.state.get().rooms[0]!.unread).toBe(0);
    expect(t.calls.some((c) => c.name === "mark_read")).toBe(true);
  });

  it("asks for notification permission once", async () => {
    const t = setup();
    await t.controller.ensureNotificationPermission();
    await t.controller.ensureNotificationPermission();
    expect(t.notifier.ensurePermission).toHaveBeenCalledTimes(1);
  });

  it("opens a room by route name", () => {
    const t = setup();
    t.controller.open("r1");
    expect(t.navigate).toHaveBeenCalledWith("ChatRoom", { roomId: "r1" });
  });

  it("keeps a live message that arrives while a refresh is in flight", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    const release = t.holdRefresh();
    const pending = t.controller.refresh();
    t.handlers.get("message")!(inbox());
    await flush();
    release();
    await pending;
    const room = t.controller.state.get().rooms[0]!;
    expect(room.lastMessage!.id).toBe("m1");
    expect(room.unread).toBe(1);
  });

  it("drops a refresh answer that a newer refresh has overtaken", async () => {
    const t = setup([row({ name: "Old" })]);
    t.controller.start();
    await flush();
    const release = t.holdRefresh();
    const slow = t.controller.refresh();
    release();
    t.setRooms([row({ name: "New" })]);
    await t.controller.refresh();
    await slow;
    expect(t.controller.state.get().rooms[0]!.name).toBe("New");
  });

  it("does not bring the badge back when a refresh predates mark_read", async () => {
    const t = setup([row({ unread: 3 })]);
    t.controller.start();
    await flush();
    const release = t.holdRefresh();
    const pending = t.controller.refresh();
    t.controller.setViewing("r1");
    release();
    await pending;
    expect(t.controller.state.get().rooms[0]!.unread).toBe(0);
  });

  it("keeps the preview on a deleted event and refreshes for the truth", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    t.handlers.get("message")!(inbox());
    await flush();
    const before = t.calls.filter((c) => c.name === "list_rooms").length;
    t.setRooms([row({ last_message: { id: "m0", sender_id: "u2", handle: "ace", body: "earlier", created_at: "2026-01-01T09:00:00.000Z" } })]);
    t.handlers.get("message_deleted")!({ room_id: "r1", message_id: "m1" });
    expect(t.controller.state.get().rooms[0]!.lastMessage!.id).toBe("m1");
    await flush();
    expect(t.calls.filter((c) => c.name === "list_rooms").length).toBe(before + 1);
    expect(t.controller.state.get().rooms[0]!.lastMessage!.id).toBe("m0");
  });

  it("shows the sender's avatar and car icon from a live message", async () => {
    const t = setup();
    t.controller.start();
    await flush();
    t.handlers.get("message")!(inbox({ avatar_path: "a/b.jpg", car_icon: "rally" }));
    expect(t.controller.state.get().messages.r1![0]).toMatchObject({ avatarPath: "a/b.jpg", carIcon: "rally" });
  });
});

describe("chat controller terms and lifecycle", () => {
  it("does not start while the terms gate shows, and starts once the version matches", async () => {
    const t = setup([row()], "background", { termsVersion: "v1" });
    const stop = t.controller.watch();
    await flush();
    expect(t.channels).toEqual([]);
    expect(t.calls).toEqual([]);
    t.session.set({ status: "signedIn", userId: "me", profile: { id: "me", handle: "tester", avatarPath: null, carIcon: "gt", termsVersion: TERMS_VERSION } });
    await flush();
    expect(t.channels).toEqual(["inbox:me"]);
    stop();
    expect(t.controller.state.get().rooms).toEqual([]);
  });

  it("starts when the profile carries no terms version, and when already signed in at registration", async () => {
    const t = setup();
    const stop = t.controller.watch();
    await flush();
    expect(t.channels).toEqual(["inbox:me"]);
    stop();
  });

  it("stops listening on teardown and on sign out", async () => {
    const t = setup();
    const stop = t.controller.watch();
    await flush();
    t.session.set({ status: "signedOut" });
    expect(t.controller.state.get().rooms).toEqual([]);
    t.session.set({ status: "signedIn", userId: "me", profile: { id: "me", handle: "tester", avatarPath: null, carIcon: "gt" } });
    await flush();
    expect(t.channels).toEqual(["inbox:me", "inbox:me"]);
    stop();
    expect(t.controller.state.get().rooms).toEqual([]);
  });
});
