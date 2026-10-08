import { AppState } from "react-native";
import type { Module } from "@rdv/core";
import { CHAT_NEW_ROOM_ROUTE, CHAT_ROOM_INFO_ROUTE, CHAT_ROOM_ROUTE, RDV_DETAIL_SLOT } from "@rdv/core/chat";
import { createChatController } from "./controller";
import { setController } from "./context";
import { notifier } from "./native";
import { NewRoom } from "./NewRoom";
import { CrewRoomLink, RdvRoomLink } from "./RoomLinks";
import { RoomInfo } from "./RoomInfo";
import { RoomScreen } from "./RoomScreen";
import { RoomsTab } from "./RoomsTab";

export { reduce, initialState, shouldNotify, notificationFor, mergeMessages, type ChatAction, type ChatState } from "./reducer";
export { createChatController, type ChatController, type RoomNotifier } from "./controller";

export const chat: Module = {
  id: "chat",
  register(shell) {
    shell.addFlag("chat", true);
    if (!shell.isEnabled("chat")) return;
    const controller = createChatController(shell, { notifier, appState: () => AppState.currentState });
    setController(shell, controller);
    shell.addTab({ id: "Rooms", title: "Rooms", icon: "chatbubble-outline", order: 25, component: RoomsTab });
    shell.addRoute({ name: CHAT_ROOM_ROUTE, component: RoomScreen, title: "Room" });
    shell.addRoute({ name: CHAT_NEW_ROOM_ROUTE, component: NewRoom, title: "New room" });
    shell.addRoute({ name: CHAT_ROOM_INFO_ROUTE, component: RoomInfo, title: "Room info" });
    shell.addSlot("crew.detail", CrewRoomLink, 5);
    shell.addSlot(RDV_DETAIL_SLOT, RdvRoomLink, 10);

    let stop: (() => void) | null = null;
    let startedFor: string | null = null;
    shell.session.subscribe(() => {
      const session = shell.session.get();
      const id = session.status === "signedIn" ? session.userId : null;
      if (id === startedFor) return;
      stop?.();
      stop = null;
      startedFor = id;
      if (id) stop = controller.start();
    });
  },
};
