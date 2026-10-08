export const CHAT_ROOM_ROUTE = "ChatRoom";
export const CHAT_NEW_ROOM_ROUTE = "ChatNewRoom";
export const CHAT_ROOM_INFO_ROUTE = "ChatRoomInfo";

// Slots rendered by the chat module. A module fills one with shell.addSlot(name, Component) and gets the props below.
// The composer actions slot sits beside the message composer (the walkie-talkie Talk button goes there); the status slot
// sits above it. A slot component is mounted while the room screen is open, so mounting is entering the room and
// unmounting is leaving it.
export const CHAT_COMPOSER_ACTIONS_SLOT = "chat.composer.actions";
export const CHAT_ROOM_STATUS_SLOT = "chat.room.status";

// Slot rendered by the rdvs module on the RDV detail screen. The chat module uses it for the RDV's room.
export const RDV_DETAIL_SLOT = "rdv.detail";

export type ChatRoomKind = "crew" | "invite" | "rdv";
// Crew rooms report the person's crew role; invite rooms owner or member; RDV rooms host or member.
export type ChatMemberRole = "owner" | "admin" | "member" | "host";

export interface ChatRoomMember {
  userId: string;
  handle: string;
  avatarPath: string | null;
  carIcon: string;
  role: ChatMemberRole;
}

export interface ChatRoomContext {
  roomId: string;
  kind: ChatRoomKind;
  name: string;
  crewId: string | null;
  rdvId: string | null;
  // A closed RDV room is readable but takes no new messages; the walkie channel is closed with it.
  closed: boolean;
  // The caller may delete any message and remove members here: invite owner, crew owner or admin, RDV host or moderator.
  canModerate: boolean;
  // Empty until loaded; refreshed while the room is open.
  members: ChatRoomMember[];
}

export interface ChatRoomSlotProps {
  room: ChatRoomContext;
}

export interface RdvDetailSlotProps {
  rdvId: string;
  isHost: boolean;
  ended: boolean;
  cancelled: boolean;
}

export interface CrewDetailSlotProps {
  crewId: string;
}
