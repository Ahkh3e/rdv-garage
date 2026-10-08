import * as Notifications from "expo-notifications";
import type { RoomNotifier } from "./controller";

// The notice that launched the app stays "last" for the whole run, so each one is acted on once.
let handled: string | null = null;

function handle(response: Notifications.NotificationResponse, fn: (roomId: string) => void) {
  const roomId = response.notification.request.content.data?.chatRoomId;
  if (typeof roomId !== "string") return;
  const id = response.notification.request.identifier;
  if (id && id === handled) return;
  handled = id ?? null;
  fn(roomId);
}

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
    try {
      const last = Notifications.getLastNotificationResponse?.();
      if (last) handle(last, fn);
    } catch {
      // Not knowing which notice launched the app must not stop chat from starting.
    }
    const subscription = Notifications.addNotificationResponseReceivedListener?.((response) => {
      handle(response, fn);
    });
    return () => subscription?.remove();
  },
};
