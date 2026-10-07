import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import type { GeoPoint } from "@rdv/core";
import { AppError } from "@rdv/core/errors";
import type { ReminderStore } from "./controller";

// One reading for I'm here. Foreground permission is asked only when the person taps the button.
export async function readPosition(): Promise<GeoPoint> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== "granted") permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") throw new AppError("location_denied");
  const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: fix.coords.latitude, lng: fix.coords.longitude };
}

// Local reminders only. Permission is the one already asked at the first Go live; nothing is asked here.
export const reminders: ReminderStore = {
  async permitted() {
    return (await Notifications.getPermissionsAsync()).granted;
  },
  async list() {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all
      .filter((n) => n.identifier.startsWith("rdv-") && n.content.data?.rdvReminder === true)
      .map((n) => ({ key: n.identifier, at: Number(n.content.data?.at), title: n.content.title ?? undefined, body: n.content.body ?? undefined }));
  },
  async schedule(reminder) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.key,
      content: { title: reminder.title, body: reminder.body, data: { rdvReminder: true, at: reminder.at } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.at) },
    });
  },
  async cancel(key) {
    await Notifications.cancelScheduledNotificationAsync(key);
  },
};
