import * as LiveActivity from "expo-live-activity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { RoomIndicator } from "./controller";

const NOTIFICATION_ID = "rdv-walkie";
const CHANNEL_ID = "walkie";
const ACTIVITY_KEY = "rdv.walkie.activity";
const LEAVE_ACTION = "leave";
const ENDED: LiveActivity.LiveActivityState = { title: "Left the room", subtitle: "", progressBar: { progress: 0 } };

// The ongoing "In a room" indicator. Android runs it as the foreground service notification that keeps the microphone
// service alive in the background, with a Leave action. iPhone uses a Live Activity, which has no button, so tapping it
// opens the app, where Leave is on the room screen. It carries the room name only: nothing about location.
export function createRoomIndicator(onLeave: () => void): RoomIndicator & { start(): () => void } {
  let activityId: string | null = null;
  let finishService: (() => void) | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const notifee = () => require("@notifee/react-native");

  const hideNow = async () => {
    if (Platform.OS === "android") {
      const { default: n } = notifee();
      await n.stopForegroundService().catch(() => undefined);
      finishService?.();
      finishService = null;
      await n.cancelNotification(NOTIFICATION_ID).catch(() => undefined);
      return;
    }
    const stale = activityId ?? (await SecureStore.getItemAsync(ACTIVITY_KEY).catch(() => null));
    activityId = null;
    if (stale) {
      try {
        LiveActivity.stopActivity(stale, ENDED);
      } catch {
        // Already ended by the system or the person.
      }
      await SecureStore.deleteItemAsync(ACTIVITY_KEY).catch(() => undefined);
    }
  };

  return {
    // Registers the Android service task and the Leave handler. Call once at startup; returns an undo.
    start() {
      void serial(hideNow);
      if (Platform.OS !== "android") return () => undefined;
      const { default: n, EventType } = notifee();
      n.registerForegroundService(() => new Promise<void>((resolve) => { finishService = resolve; }));
      const onEvent = async ({ type, detail }: any) => {
        if (type === EventType.ACTION_PRESS && detail.pressAction?.id === LEAVE_ACTION) onLeave();
      };
      n.onBackgroundEvent(onEvent);
      return n.onForegroundEvent(onEvent);
    },
    show: (roomName) =>
      serial(async () => {
        if (Platform.OS === "android") {
          const { default: n, AndroidImportance, AndroidForegroundServiceType } = notifee();
          await n.requestPermission().catch(() => undefined);
          await n.createChannel({ id: CHANNEL_ID, name: "Walkie-talkie", importance: AndroidImportance.LOW });
          await n.displayNotification({
            id: NOTIFICATION_ID,
            title: "In a room",
            body: roomName,
            android: {
              channelId: CHANNEL_ID,
              asForegroundService: true,
              ongoing: true,
              foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE],
              pressAction: { id: "default", launchActivity: "default" },
              actions: [{ title: "Leave", pressAction: { id: LEAVE_ACTION } }],
            },
          });
          return;
        }
        await hideNow();
        try {
          const state: LiveActivity.LiveActivityState = { title: "In a room", subtitle: roomName, progressBar: { progress: 1 } };
          const id = LiveActivity.startActivity(state, {
            backgroundColor: "#0E1118",
            titleColor: "#F2F5FA",
            subtitleColor: "#A3ABBA",
            progressViewTint: "#5EA0FF",
            deepLinkUrl: "/",
            padding: { horizontal: 18, top: 14, bottom: 14 },
          });
          if (id) {
            activityId = id;
            await SecureStore.setItemAsync(ACTIVITY_KEY, id).catch(() => undefined);
          }
        } catch {
          // Live Activities are off or unsupported; the audio session itself keeps the app alive.
        }
      }),
    hide: () => serial(hideNow),
  };
}
