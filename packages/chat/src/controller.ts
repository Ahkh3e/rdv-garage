import type { ChannelLike, Shell } from "@rdv/core";
import { CHAT_ROOM_ROUTE, type ChatRoomMember } from "@rdv/core/chat";
import { TERMS_VERSION } from "@rdv/core/legal";
import { createStore, type Store } from "@rdv/core/store";
import {
  memberFromRow, messageFromRow, PAGE, roomFromRow,
  type InboxMessage, type MemberRow, type Message, type MessageRow, type Room, type RoomRow,
} from "./model";
import { initialState, notificationFor, reduce, shouldNotify, type ChatAction, type ChatState } from "./reducer";

export interface LocalNotice {
  roomId: string;
  title: string;
  body: string;
}

export interface RoomNotifier {
  // Asks only if the system still allows asking.
  ensurePermission(): Promise<boolean>;
  show(notice: LocalNotice): Promise<void>;
  onOpen(fn: (roomId: string) => void): () => void;
}

export type ControllerShell = Pick<Shell, "backend" | "session" | "navigate" | "events">;

export const RETRY_MS = 5000;
export const REFRESH_MS = 60000;
const MARK_READ_MS = 1500;

const noop = () => undefined;

// Matches the terms gate: an unknown version is not asked to accept again.
export const termsCleared = (profile: { termsVersion?: string | null }) => profile.termsVersion == null || profile.termsVersion === TERMS_VERSION;

export function createChatController(
  shell: ControllerShell,
  deps: { notifier: RoomNotifier; appState: () => string; retryMs?: number },
) {
  const state = createStore<ChatState>(initialState);
  const retryMs = deps.retryMs ?? RETRY_MS;
  let asked = false;
  let seq = 0;
  const readTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const dispatch = (action: ChatAction) => state.set((prev) => reduce(prev, action));
  const profile = () => {
    const session = shell.session.get();
    return session.status === "signedIn" ? session.profile : null;
  };
  const selfId = () => profile()?.id ?? null;
  const rpc = <T>(name: string, args?: Record<string, unknown>) => shell.backend.rpc<T>("chat", name, args);

  const controller = {
    state: state as Store<ChatState>,

    room(id: string): Room | undefined {
      return state.get().rooms.find((r) => r.id === id);
    },

    // The newest call wins; an older answer that lands later is dropped.
    async refresh(): Promise<void> {
      const mine = ++seq;
      const rows = await rpc<RoomRow[]>("list_rooms");
      if (mine !== seq) return;
      dispatch({ type: "rooms", rooms: rows.map(roomFromRow) });
    },

    // The preview is kept as it is; the server decides what the last message is now.
    onDeleted(roomId: string, messageId: string) {
      dispatch({ type: "deleted", roomId, messageId });
      void controller.refresh().catch(noop);
    },

    async loadHistory(roomId: string, before?: string): Promise<boolean> {
      const rows = await rpc<MessageRow[]>("list_messages", { p_room: roomId, p_before: before ?? null, p_limit: PAGE });
      dispatch({ type: "history", roomId, messages: rows.map((r) => messageFromRow(roomId, r)) });
      return rows.length === PAGE;
    },

    loadOlder(roomId: string): Promise<boolean> {
      const oldest = state.get().messages[roomId]?.[0];
      return controller.loadHistory(roomId, oldest?.createdAt);
    },

    async send(roomId: string, body: string): Promise<void> {
      const row = await rpc<{ id: string; sender_id: string; handle: string; body: string; created_at: string }>("send_message", { p_room: roomId, p_body: body });
      const me = profile();
      const message: Message = {
        id: row.id, roomId, senderId: row.sender_id, handle: row.handle, avatarPath: me?.avatarPath ?? null, carIcon: me?.carIcon ?? "gt", body: row.body, createdAt: row.created_at,
      };
      dispatch({ type: "sent", message, self: selfId() });
    },

    async remove(roomId: string, messageId: string): Promise<void> {
      await rpc("delete_message", { p_message: messageId });
      controller.onDeleted(roomId, messageId);
    },

    markRead(roomId: string): Promise<void> {
      dispatch({ type: "read", roomId });
      return rpc<void>("mark_read", { p_room: roomId }).catch(noop);
    },

    markReadSoon(roomId: string) {
      dispatch({ type: "read", roomId });
      if (readTimers.has(roomId)) return;
      readTimers.set(roomId, setTimeout(() => {
        readTimers.delete(roomId);
        void rpc<void>("mark_read", { p_room: roomId }).catch(noop);
      }, MARK_READ_MS));
    },

    setViewing(roomId: string | null) {
      dispatch({ type: "viewing", roomId });
      if (roomId) void controller.markRead(roomId);
    },

    async setMuted(roomId: string, muted: boolean): Promise<void> {
      await rpc("set_room_muted", { p_room: roomId, p_muted: muted });
      dispatch({ type: "muted", roomId, muted });
    },

    async createRoom(name: string, description: string, memberIds: string[]): Promise<string> {
      const id = await rpc<string>("create_room", { p_name: name, p_description: description.trim() || null, p_member_ids: memberIds });
      await controller.refresh().catch(noop);
      return id;
    },

    async members(roomId: string): Promise<ChatRoomMember[]> {
      return (await rpc<MemberRow[]>("list_room_members", { p_room: roomId })).map(memberFromRow);
    },

    async addMember(roomId: string, userId: string) {
      await rpc("add_room_member", { p_room: roomId, p_user: userId });
      await controller.refresh().catch(noop);
    },
    async removeMember(roomId: string, userId: string) {
      await rpc("remove_room_member", { p_room: roomId, p_user: userId });
      await controller.refresh().catch(noop);
    },
    async leave(roomId: string) {
      await rpc("leave_room", { p_room: roomId });
      await controller.refresh().catch(noop);
    },
    async deleteRoom(roomId: string) {
      await rpc("delete_room", { p_room: roomId });
      await controller.refresh().catch(noop);
    },
    async transfer(roomId: string, userId: string) {
      await rpc("transfer_room", { p_room: roomId, p_user: userId });
      await controller.refresh().catch(noop);
    },

    async openRdvRoom(rdvId: string): Promise<string> {
      const id = await rpc<string>("open_rdv_room", { p_rdv: rdvId });
      await controller.refresh().catch(noop);
      return id;
    },

    open(roomId: string) {
      shell.navigate(CHAT_ROOM_ROUTE, { roomId });
    },

    // Asked the first time the Rooms tab is opened, not at launch. Refusing leaves chat working.
    async ensureNotificationPermission(): Promise<void> {
      if (asked) return;
      asked = true;
      await deps.notifier.ensurePermission().catch(() => false);
    },

    async onInbox(event: InboxMessage) {
      if (!event?.room_id || !event.message_id) return;
      const self = selfId();
      dispatch({ type: "incoming", event, self });
      if (!controller.room(event.room_id)) await controller.refresh().catch(noop);
      const current = state.get();
      const room = current.rooms.find((r) => r.id === event.room_id);
      const appActive = deps.appState() === "active";
      if (room && event.sender_id !== self && current.viewing === room.id && appActive) controller.markReadSoon(room.id);
      if (!shouldNotify({ event, self, room, viewing: current.viewing, appActive })) return;
      await deps.notifier.show(notificationFor(event, room!)).catch(noop);
    },

    start(): () => void {
      const uid = selfId();
      if (!uid) return noop;
      let stopped = false;
      let channel: ChannelLike | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      let connectedOnce = false;

      const connect = () => {
        if (stopped) return;
        const next = shell.backend.channel(`inbox:${uid}`);
        channel = next;
        next.on("message", (payload) => void controller.onInbox(payload as InboxMessage));
        next.on("message_deleted", (payload: { room_id: string; message_id: string }) => controller.onDeleted(payload.room_id, payload.message_id));
        next.on("room_changed", () => void controller.refresh().catch(noop));
        next.subscribe((status) => {
          if (stopped || channel !== next) return;
          if (status === "SUBSCRIBED") {
            // After a drop, catch up on what arrived while disconnected.
            if (connectedOnce) {
              void controller.refresh().catch(noop);
              const viewing = state.get().viewing;
              if (viewing) void controller.loadHistory(viewing).catch(noop);
            }
            connectedOnce = true;
          } else if (!retry) {
            void next.unsubscribe().catch(noop);
            retry = setTimeout(() => {
              retry = null;
              connect();
            }, retryMs);
          }
        });
      };

      void controller.refresh().catch(noop);
      connect();
      const timer = setInterval(() => void controller.refresh().catch(noop), REFRESH_MS);
      const offOpen = deps.notifier.onOpen((roomId) => controller.open(roomId));
      return () => {
        stopped = true;
        clearInterval(timer);
        offOpen();
        if (retry) clearTimeout(retry);
        for (const t of readTimers.values()) clearTimeout(t);
        readTimers.clear();
        void channel?.unsubscribe().catch(noop);
        seq++;
        dispatch({ type: "reset" });
      };
    },

    // Runs the controller while someone is signed in and has accepted the current terms.
    watch(): () => void {
      let stop: (() => void) | null = null;
      let runningFor: string | null = null;
      const sync = () => {
        const session = shell.session.get();
        const id = session.status === "signedIn" && termsCleared(session.profile) ? session.userId : null;
        if (id === runningFor) return;
        stop?.();
        stop = null;
        runningFor = id;
        if (id) stop = controller.start();
      };
      const off = shell.session.subscribe(sync);
      sync();
      return () => {
        off();
        stop?.();
        stop = null;
        runningFor = null;
      };
    },
  };

  return controller;
}

export type ChatController = ReturnType<typeof createChatController>;
