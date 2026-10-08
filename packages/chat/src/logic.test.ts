import { describe, expect, it } from "vitest";
import {
  badgeLabel, canDelete, canSend, membersOfCrews, previewLine, roomFromRow, shortAge, showsSender, sortRooms,
  type InboxMessage, type Message, type Room, type RoomRow,
} from "./model";
import { initialState, mergeMessages, notificationFor, reduce, shouldNotify, type ChatState } from "./reducer";

const room = (over: Partial<Room> = {}): Room => ({
  id: "r1", kind: "invite", name: "Late night", description: null, crewId: null, rdvId: null, closed: false, isOwner: false, muted: false,
  canModerate: false, memberCount: 3, unread: 0, lastMessage: null, ...over,
});
const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1", roomId: "r1", senderId: "u2", handle: "ace", avatarPath: null, carIcon: "gt", body: "hello", createdAt: "2026-01-01T10:00:00.000Z", ...over,
});
const event = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  room_id: "r1", message_id: "m9", sender_id: "u2", handle: "ace", text: "yo", created_at: "2026-01-01T10:05:00.000Z", ...over,
});
const withRooms = (rooms: Room[], extra: Partial<ChatState> = {}): ChatState => ({ ...initialState, loaded: true, rooms, ...extra });

describe("rows", () => {
  it("maps a room row", () => {
    const row: RoomRow = {
      id: "r1", kind: "rdv", name: "Meet", description: null, crew_id: null, rdv_id: "d1", status: "closed", role: "member", muted: true, can_moderate: true,
      members: 4, unread: 2, last_message: { id: "m1", sender_id: "u2", handle: "ace", body: "hi", created_at: "2026-01-01T10:00:00.000Z" },
    };
    expect(roomFromRow(row)).toMatchObject({ kind: "rdv", rdvId: "d1", closed: true, isOwner: false, muted: true, canModerate: true, memberCount: 4, unread: 2 });
    expect(roomFromRow(row).lastMessage).toMatchObject({ senderId: "u2", handle: "ace", body: "hi" });
    expect(roomFromRow({ ...row, last_message: null, role: "owner" })).toMatchObject({ lastMessage: null, isOwner: true });
  });
});

describe("sorting and labels", () => {
  it("lists crew rooms first, newest activity first, empty rooms last by name", () => {
    const at = (iso: string) => ({ id: "x", senderId: "u", handle: "h", body: "b", createdAt: iso });
    const sorted = sortRooms([
      room({ id: "a", name: "Zed", lastMessage: at("2026-01-02T00:00:00Z") }),
      room({ id: "b", kind: "crew", name: "Crew B" }),
      room({ id: "c", name: "Alpha" }),
      room({ id: "d", kind: "crew", name: "Crew A", lastMessage: at("2026-01-01T00:00:00Z") }),
      room({ id: "e", name: "Newer", lastMessage: at("2026-01-03T00:00:00Z") }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("shows the last line, who said it, and an empty note", () => {
    expect(previewLine(room(), "me")).toBe("No messages yet");
    const last = { id: "m", senderId: "u2", handle: "ace", body: "two\nlines", createdAt: "x" };
    expect(previewLine(room({ lastMessage: last }), "me")).toBe("@ace: two lines");
    expect(previewLine(room({ lastMessage: { ...last, senderId: "me" } }), "me")).toBe("You: two lines");
  });

  it("formats ages and badges", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(shortAge("2026-01-01T11:59:40Z", now)).toBe("now");
    expect(shortAge("2026-01-01T11:15:00Z", now)).toBe("45m");
    expect(shortAge("2026-01-01T09:00:00Z", now)).toBe("3h");
    expect(shortAge("2025-12-30T12:00:00Z", now)).toBe("2d");
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(250)).toBe("99+");
  });

  it("starts a new sender group on a different sender or after a pause", () => {
    const a = msg();
    expect(showsSender(undefined, a)).toBe(true);
    expect(showsSender(a, msg({ id: "m2", createdAt: "2026-01-01T10:02:00.000Z" }))).toBe(false);
    expect(showsSender(a, msg({ id: "m2", createdAt: "2026-01-01T10:06:00.000Z" }))).toBe(true);
    expect(showsSender(a, msg({ id: "m2", senderId: "u3" }))).toBe(true);
  });
});

describe("rules", () => {
  it("allows deleting your own message or any message as a moderator", () => {
    expect(canDelete(msg(), room(), "u2")).toBe(true);
    expect(canDelete(msg(), room(), "u3")).toBe(false);
    expect(canDelete(msg(), room({ canModerate: true }), "u3")).toBe(true);
  });

  it("accepts 1 to 1000 characters that are not only whitespace", () => {
    expect(canSend("")).toBe(false);
    expect(canSend("   \n")).toBe(false);
    expect(canSend("a")).toBe(true);
    expect(canSend("a".repeat(1000))).toBe(true);
    expect(canSend("a".repeat(1001))).toBe(false);
  });

  it("lists people from your crews once, with the crews you share, without yourself", () => {
    const people = membersOfCrews(
      [
        { name: "A", members: [{ userId: "me", handle: "me", avatarPath: null }, { userId: "u2", handle: "zed", avatarPath: null }] },
        { name: "B", members: [{ userId: "u2", handle: "zed", avatarPath: null }, { userId: "u3", handle: "amy", avatarPath: null }] },
      ],
      "me",
    );
    expect(people.map((p) => p.handle)).toEqual(["amy", "zed"]);
    expect(people[1]!.crews).toEqual(["A", "B"]);
  });
});

describe("reducer", () => {
  it("replaces the room list and drops history of rooms that are gone", () => {
    let s = withRooms([room({ id: "a" }), room({ id: "b" })], { messages: { a: [msg({ roomId: "a" })], b: [msg({ id: "m2", roomId: "b" })] } });
    s = reduce(s, { type: "rooms", rooms: [room({ id: "b" })] });
    expect(Object.keys(s.messages)).toEqual(["b"]);
  });

  it("appends a live message, updates the last line and counts it as unread", () => {
    let s = withRooms([room({ lastMessage: null })]);
    s = reduce(s, { type: "incoming", event: event(), self: "me" });
    expect(s.messages.r1!.map((m) => m.id)).toEqual(["m9"]);
    expect(s.rooms[0]).toMatchObject({ unread: 1, lastMessage: { id: "m9", body: "yo", handle: "ace" } });
  });

  it("ignores a repeated message, and does not count your own or one in the room on screen", () => {
    let s = withRooms([room()]);
    s = reduce(s, { type: "incoming", event: event(), self: "me" });
    const again = reduce(s, { type: "incoming", event: event(), self: "me" });
    expect(again).toBe(s);
    s = reduce(s, { type: "incoming", event: event({ message_id: "m10", sender_id: "me" }), self: "me" });
    expect(s.rooms[0]!.unread).toBe(1);
    s = reduce(s, { type: "viewing", roomId: "r1" });
    s = reduce(s, { type: "incoming", event: event({ message_id: "m11" }), self: "me" });
    expect(s.rooms[0]!.unread).toBe(1);
  });

  it("merges history by id in time order and keeps a sent message once", () => {
    const a = msg({ id: "a", createdAt: "2026-01-01T10:00:00.000Z" });
    const b = msg({ id: "b", createdAt: "2026-01-01T10:01:00.000Z" });
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(["a", "b"]);
    let s = withRooms([room()]);
    s = reduce(s, { type: "history", roomId: "r1", messages: [a, b] });
    s = reduce(s, { type: "sent", message: b, self: "u2" });
    expect(s.messages.r1).toHaveLength(2);
  });

  it("deletes a message and moves the last line back", () => {
    const newest = { id: "b", senderId: "u2", handle: "ace", body: "newest", createdAt: "2026-01-01T10:01:00.000Z" };
    let s = withRooms([room({ lastMessage: newest })]);
    s = reduce(s, { type: "history", roomId: "r1", messages: [msg({ id: "a" }), msg({ id: "b", createdAt: newest.createdAt, body: "newest" })] });
    s = reduce(s, { type: "deleted", roomId: "r1", messageId: "b" });
    expect(s.messages.r1!.map((m) => m.id)).toEqual(["a"]);
    expect(s.rooms[0]!.lastMessage!.id).toBe("a");
  });

  it("clears unread when read, and sets mute", () => {
    let s = withRooms([room({ unread: 4 })]);
    s = reduce(s, { type: "read", roomId: "r1" });
    s = reduce(s, { type: "muted", roomId: "r1", muted: true });
    expect(s.rooms[0]).toMatchObject({ unread: 0, muted: true });
    expect(reduce(s, { type: "reset" })).toEqual(initialState);
  });

  it("keeps only the newest messages per room", () => {
    const many = Array.from({ length: 320 }, (_, i) => msg({ id: `m${String(i).padStart(3, "0")}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
    const merged = mergeMessages([], many);
    expect(merged).toHaveLength(300);
    expect(merged[299]!.id).toBe("m319");
  });
});

describe("notifications", () => {
  const base = { event: event(), self: "me", room: room(), viewing: null, appActive: true };
  it("notifies for someone else's message in a room that is not muted and not on screen", () => {
    expect(shouldNotify(base)).toBe(true);
    expect(shouldNotify({ ...base, appActive: false })).toBe(true);
    expect(shouldNotify({ ...base, viewing: "other" })).toBe(true);
  });

  it("stays quiet for yourself, a muted room, an unknown room, and the room you are looking at", () => {
    expect(shouldNotify({ ...base, event: event({ sender_id: "me" }) })).toBe(false);
    expect(shouldNotify({ ...base, room: room({ muted: true }) })).toBe(false);
    expect(shouldNotify({ ...base, room: undefined })).toBe(false);
    expect(shouldNotify({ ...base, viewing: "r1" })).toBe(false);
    expect(shouldNotify({ ...base, viewing: "r1", appActive: false })).toBe(true);
  });

  it("titles the notice with the handle and room and carries the text", () => {
    expect(notificationFor(event(), room())).toEqual({ roomId: "r1", title: "@ace in Late night", body: "yo" });
  });
});
