import type { ChatMemberRole, ChatRoomKind, ChatRoomMember } from "@rdv/core/chat";

export const MAX_BODY = 1000;
export const KEEP_PER_ROOM = 300;
export const PAGE = 50;

export interface LastMessage {
  id: string;
  senderId: string;
  handle: string;
  body: string;
  createdAt: string;
}

export interface Room {
  id: string;
  kind: ChatRoomKind;
  name: string;
  description: string | null;
  crewId: string | null;
  rdvId: string | null;
  closed: boolean;
  isOwner: boolean;
  muted: boolean;
  canModerate: boolean;
  memberCount: number;
  unread: number;
  lastMessage: LastMessage | null;
}

export interface Message {
  id: string;
  roomId: string;
  senderId: string;
  handle: string;
  avatarPath: string | null;
  carIcon: string;
  body: string;
  createdAt: string;
}

export interface RoomRow {
  id: string;
  kind: ChatRoomKind;
  name: string;
  description: string | null;
  crew_id: string | null;
  rdv_id: string | null;
  status: string;
  role: string;
  muted: boolean;
  can_moderate: boolean;
  members: number;
  unread: number;
  last_message: { id: string; sender_id: string; handle: string; body: string; created_at: string } | null;
}

export interface MessageRow {
  id: string;
  sender_id: string;
  handle: string;
  avatar_path: string | null;
  car_icon?: string | null;
  body: string;
  created_at: string;
}

export interface MemberRow {
  user_id: string;
  handle: string;
  avatar_path: string | null;
  car_icon?: string | null;
  role: ChatMemberRole;
}

export interface InboxMessage {
  room_id: string;
  message_id: string;
  sender_id: string;
  handle: string;
  text: string;
  created_at: string;
}

export const roomFromRow = (row: RoomRow): Room => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  description: row.description,
  crewId: row.crew_id,
  rdvId: row.rdv_id,
  closed: row.status === "closed",
  isOwner: row.role === "owner",
  muted: row.muted,
  canModerate: row.can_moderate,
  memberCount: Number(row.members),
  unread: Number(row.unread),
  lastMessage: row.last_message
    ? { id: row.last_message.id, senderId: row.last_message.sender_id, handle: row.last_message.handle, body: row.last_message.body, createdAt: row.last_message.created_at }
    : null,
});

export const messageFromRow = (roomId: string, row: MessageRow): Message => ({
  id: row.id,
  roomId,
  senderId: row.sender_id,
  handle: row.handle,
  avatarPath: row.avatar_path,
  carIcon: row.car_icon ?? "gt",
  body: row.body,
  createdAt: row.created_at,
});

export const messageFromInbox = (event: InboxMessage, avatarPath: string | null = null, carIcon = "gt"): Message => ({
  id: event.message_id,
  roomId: event.room_id,
  senderId: event.sender_id,
  handle: event.handle,
  avatarPath,
  carIcon,
  body: event.text,
  createdAt: event.created_at,
});

export const memberFromRow = (row: MemberRow): ChatRoomMember => ({
  userId: row.user_id,
  handle: row.handle,
  avatarPath: row.avatar_path,
  carIcon: row.car_icon ?? "gt",
  role: row.role,
});

const time = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);

// Crew rooms first, then the rest; newest activity first inside each group, rooms without messages last by name.
export function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => {
    const group = Number(b.kind === "crew") - Number(a.kind === "crew");
    if (group) return group;
    const at = time(a.lastMessage?.createdAt);
    const bt = time(b.lastMessage?.createdAt);
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
}

export function previewLine(room: Room, selfId: string | null): string {
  const last = room.lastMessage;
  if (!last) return "No messages yet";
  return `${last.senderId === selfId ? "You" : `@${last.handle}`}: ${last.body.replace(/\s+/g, " ").trim()}`;
}

export function shortAge(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const clockTime = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const GROUP_GAP_MS = 5 * 60000;

// A sender line is shown when the sender changes or after a pause. Messages are ordered oldest first.
export function showsSender(previous: Message | undefined, current: Message): boolean {
  if (!previous || previous.senderId !== current.senderId) return true;
  return Date.parse(current.createdAt) - Date.parse(previous.createdAt) > GROUP_GAP_MS;
}

export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function canDelete(message: Message, room: Room | undefined, selfId: string | null): boolean {
  return message.senderId === selfId || !!room?.canModerate;
}

export function canSend(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && body.length <= MAX_BODY;
}

export function membersOfCrews(
  crews: { name: string; members: { userId: string; handle: string; avatarPath: string | null }[] }[],
  selfId: string | null,
): { userId: string; handle: string; avatarPath: string | null; crews: string[] }[] {
  const byId = new Map<string, { userId: string; handle: string; avatarPath: string | null; crews: string[] }>();
  for (const crew of crews) {
    for (const member of crew.members) {
      if (member.userId === selfId) continue;
      const entry = byId.get(member.userId) ?? { userId: member.userId, handle: member.handle, avatarPath: member.avatarPath, crews: [] };
      entry.crews.push(crew.name);
      byId.set(member.userId, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.handle.localeCompare(b.handle));
}
