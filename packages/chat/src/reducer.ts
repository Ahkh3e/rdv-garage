import { KEEP_PER_ROOM, sortRooms, type InboxMessage, type Message, type Room } from "./model";
import { messageFromInbox } from "./model";

export interface ChatState {
  loaded: boolean;
  rooms: Room[];
  messages: Record<string, Message[]>;
  // The room on screen with the app in the foreground. Messages there are read as they arrive.
  viewing: string | null;
}

export const initialState: ChatState = { loaded: false, rooms: [], messages: {}, viewing: null };

export type ChatAction =
  | { type: "rooms"; rooms: Room[] }
  | { type: "history"; roomId: string; messages: Message[] }
  | { type: "incoming"; event: InboxMessage; self: string | null }
  | { type: "sent"; message: Message; self: string | null }
  | { type: "deleted"; roomId: string; messageId: string }
  | { type: "viewing"; roomId: string | null }
  | { type: "read"; roomId: string }
  | { type: "muted"; roomId: string; muted: boolean }
  | { type: "reset" };

const byTime = (a: Message, b: Message) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);

const richness = (m: Message) => Number(m.avatarPath != null) + Number(m.carIcon !== "gt");

export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const seen = new Map<string, Message>();
  for (const m of existing) seen.set(m.id, m);
  for (const m of incoming) {
    const have = seen.get(m.id);
    if (!have || richness(m) >= richness(have)) seen.set(m.id, m);
  }
  const all = [...seen.values()].sort(byTime);
  return all.length > KEEP_PER_ROOM ? all.slice(all.length - KEEP_PER_ROOM) : all;
}

// A server snapshot can be older than what arrived live while it was in flight. Newer local state is kept.
function mergeRoom(state: ChatState, incoming: Room): Room {
  const local = state.rooms.find((r) => r.id === incoming.id);
  if (!local) return incoming;
  const localLast = local.lastMessage;
  const localHeld = !!localLast && !!state.messages[local.id]?.some((m) => m.id === localLast.id);
  const localNewer = localHeld && (!incoming.lastMessage || Date.parse(localLast!.createdAt) > Date.parse(incoming.lastMessage.createdAt));
  const unread = state.viewing === incoming.id ? Math.min(local.unread, incoming.unread) : localNewer ? Math.max(local.unread, incoming.unread) : incoming.unread;
  return { ...incoming, lastMessage: localNewer ? localLast : incoming.lastMessage, unread };
}

function addMessage(state: ChatState, message: Message, self: string | null): ChatState {
  const known = state.messages[message.roomId] ?? [];
  if (known.some((m) => m.id === message.id)) return state;
  const messages = { ...state.messages, [message.roomId]: mergeMessages(known, [message]) };
  const mine = message.senderId === self;
  const rooms = state.rooms.map((room) => {
    if (room.id !== message.roomId) return room;
    const newest = !room.lastMessage || Date.parse(message.createdAt) >= Date.parse(room.lastMessage.createdAt);
    return {
      ...room,
      lastMessage: newest ? { id: message.id, senderId: message.senderId, handle: message.handle, body: message.body, createdAt: message.createdAt } : room.lastMessage,
      unread: mine || state.viewing === room.id ? room.unread : room.unread + 1,
    };
  });
  return { ...state, messages, rooms: sortRooms(rooms) };
}

export function reduce(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "rooms": {
      const ids = new Set(action.rooms.map((r) => r.id));
      const messages = Object.fromEntries(Object.entries(state.messages).filter(([id]) => ids.has(id)));
      const rooms = action.rooms.map((incoming) => mergeRoom(state, incoming));
      return { ...state, loaded: true, rooms: sortRooms(rooms), messages };
    }
    case "history":
      return { ...state, messages: { ...state.messages, [action.roomId]: mergeMessages(state.messages[action.roomId] ?? [], action.messages) } };
    case "incoming":
      return addMessage(state, messageFromInbox(action.event), action.self);
    case "sent":
      return addMessage(state, action.message, action.self);
    case "deleted": {
      const known = state.messages[action.roomId];
      if (!known) return state;
      return { ...state, messages: { ...state.messages, [action.roomId]: known.filter((m) => m.id !== action.messageId) } };
    }
    case "viewing":
      return { ...state, viewing: action.roomId };
    case "read":
      return { ...state, rooms: state.rooms.map((room) => (room.id === action.roomId && room.unread ? { ...room, unread: 0 } : room)) };
    case "muted":
      return { ...state, rooms: state.rooms.map((room) => (room.id === action.roomId ? { ...room, muted: action.muted } : room)) };
  }
}

export interface NotifyInput {
  event: InboxMessage;
  self: string | null;
  room: Room | undefined;
  viewing: string | null;
  appActive: boolean;
}

// A message from someone else raises a local notification unless the room is muted or is the one on screen.
export function shouldNotify({ event, self, room, viewing, appActive }: NotifyInput): boolean {
  if (!room || event.sender_id === self || room.muted) return false;
  return !(appActive && viewing === room.id);
}

export const notificationFor = (event: InboxMessage, room: Room) => ({
  roomId: room.id,
  title: `@${event.handle} in ${room.name}`,
  body: event.text,
});
