import * as LiveActivity from "expo-live-activity";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const LIVE_NOTIFICATION_ID = "rdv-live";
const LIVE_CHANNEL = "live";
const ACTIVITY_KEY = "rdv.live.activity";
const ENDED: LiveActivity.LiveActivityState = { title: "Live ended", subtitle: "You are no longer sharing", progressBar: { progress: 0 } };

export interface Notifier {
  ensurePermission(): Promise<boolean>;
  showLive(): Promise<void>;
  hideLive(): Promise<void>;
  showFriend(userId: string, handle: string, crewName: string | null): Promise<void>;
}

export function createNotifier(): Notifier {
  let activity: { id: string; state: LiveActivity.LiveActivityState } | null = null;
  let asked = false;
  // Showing and hiding run one after the other, so a quick start then stop cannot leave a stale indicator behind.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  // Banners show even while the app is open; the module decides when a banner is worth showing.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  let channelReady: Promise<unknown> | null = null;
  const channel = () =>
    (channelReady ??=
      Platform.OS === "android"
        ? Notifications.setNotificationChannelAsync(LIVE_CHANNEL, { name: "Live", importance: Notifications.AndroidImportance.DEFAULT, sound: null })
        : Promise.resolve());

  return {
    async ensurePermission() {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      // Android keeps saying it can ask again after a refusal; asking at every Go live would nag, so ask once per launch.
      if (!current.canAskAgain || asked) return false;
      asked = true;
      return (await Notifications.requestPermissionsAsync()).granted;
    },
    showLive: () => serial(async () => {
      // No crew names: a person can be live to several crews at once.
      const subtitle = "Sharing your live location with your crews";
      if (Platform.OS === "ios") {
        // A Live Activity stays on the lock screen and in the Dynamic Island for as long as the session runs: the iPhone
        // equivalent of an ongoing notification. It returns nothing on iPhones that cannot run one (below iOS 16.2).
        try {
          if (activity) LiveActivity.stopActivity(activity.id, activity.state);
          const state: LiveActivity.LiveActivityState = { title: "You're live", subtitle, progressBar: { progress: 1 } };
          const id = LiveActivity.startActivity(state, {
            backgroundColor: "#0E1118",
            titleColor: "#F2F5FA",
            subtitleColor: "#A3ABBA",
            progressViewTint: "#5EA0FF",
            deepLinkUrl: "/",
            padding: { horizontal: 18, top: 14, bottom: 14 },
          });
          if (id) {
            activity = { id, state };
            // Remembered so that an activity left behind when the app was killed can be ended at the next launch.
            await SecureStore.setItemAsync(ACTIVITY_KEY, id).catch(() => undefined);
            return;
          }
        } catch {
          // Fall through to the plain notification.
        }
      }
      // Android shows the location service's own ongoing notification; elsewhere fall back to a normal notification.
      if (Platform.OS === "android") return;
      await channel();
      await Notifications.scheduleNotificationAsync({
        identifier: LIVE_NOTIFICATION_ID,
        content: { title: "You're live", body: `${subtitle}. Open RDV Garage to stop.`, sticky: true, autoDismiss: false },
        trigger: null,
      });
    }),
    hideLive: () => serial(async () => {
      if (activity) {
        try {
          LiveActivity.stopActivity(activity.id, { ...activity.state, title: "Live ended", subtitle: "You are no longer sharing" });
        } catch {
          // Already ended by the system or the person.
        }
        activity = null;
      }
      // A leftover from an earlier launch (the app was killed while live).
      const stale = await SecureStore.getItemAsync(ACTIVITY_KEY).catch(() => null);
      if (stale) {
        try {
          LiveActivity.stopActivity(stale, ENDED);
        } catch {
          // Already gone.
        }
        await SecureStore.deleteItemAsync(ACTIVITY_KEY).catch(() => undefined);
      }
      await Notifications.dismissNotificationAsync(LIVE_NOTIFICATION_ID).catch(() => undefined);
      await Notifications.cancelScheduledNotificationAsync(LIVE_NOTIFICATION_ID).catch(() => undefined);
    }),
    async showFriend(userId, handle, crewName) {
      await channel();
      await Notifications.scheduleNotificationAsync({
        identifier: `rdv-friend-${userId}`,
        content: { title: `@${handle} is live`, body: crewName ?? "Open RDV Garage to see them on the map", sound: false },
        trigger: Platform.OS === "android" ? { channelId: LIVE_CHANNEL } : null,
      });
    },
  };
}
