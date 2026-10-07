import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const LIVE_NOTIFICATION_ID = "rdv-live";
const LIVE_CHANNEL = "live";

export interface Notifier {
  ensurePermission(): Promise<boolean>;
  showLive(crewNames: string[]): Promise<void>;
  hideLive(): Promise<void>;
  showFriend(userId: string, handle: string, crewName: string): Promise<void>;
}

export function createNotifier(): Notifier {
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
      if (!current.canAskAgain) return false;
      return (await Notifications.requestPermissionsAsync()).granted;
    },
    async showLive(crewNames) {
      await channel();
      await Notifications.scheduleNotificationAsync({
        identifier: LIVE_NOTIFICATION_ID,
        content: {
          title: "You're live",
          body: crewNames.length ? `Visible to ${crewNames.join(", ")}. Open RDV Garage to stop.` : "Your crew can see you. Open RDV Garage to stop.",
          sticky: true,
          autoDismiss: false,
          priority: Notifications.AndroidNotificationPriority.LOW,
        },
        trigger: null,
      });
    },
    async hideLive() {
      await Notifications.dismissNotificationAsync(LIVE_NOTIFICATION_ID).catch(() => undefined);
      await Notifications.cancelScheduledNotificationAsync(LIVE_NOTIFICATION_ID).catch(() => undefined);
    },
    async showFriend(userId, handle, crewName) {
      await channel();
      await Notifications.scheduleNotificationAsync({
        identifier: `rdv-friend-${userId}`,
        content: { title: `@${handle} is live`, body: crewName, sound: false },
        trigger: null,
      });
    },
  };
}
