import * as Notifications from "expo-notifications";
import type { RoomNotifier } from "./controller";

// Local notifications only. The text of a message never leaves the phone: a notice is built from the inbox event.
export const notifier: RoomNotifier = {
  async ensurePermission() {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  },
  async show({ roomId, title, body }) {
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: { chatRoomId: roomId } }, trigger: null });
  },
  onOpen(fn) {
    const subscription = Notifications.addNotificationResponseReceivedListener?.((response) => {
      const roomId = response.notification.request.content.data?.chatRoomId;
      if (typeof roomId === "string") fn(roomId);
    });
    return () => subscription?.remove();
  },
};
