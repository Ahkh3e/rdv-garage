import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { Fix } from "./engine";

export const LOCATION_TASK = "rdv-live-location";

type Sink = (fix: Fix) => void;
let sink: Sink | null = null;

export function setFixSink(next: Sink | null) {
  sink = next;
}

// Must run at import time so the task exists when the OS wakes the app for a location update.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations?: Location.LocationObject[] }>) => {
  if (error || !data?.locations) return;
  if (!sink) {
    // The OS woke the app (or Android restarted it) with no live session in memory. Nothing would be shared, so do not
    // leave the "RDV Garage is live" notification running: stop the updates.
    await stopUpdates().catch(() => undefined);
    return;
  }
  for (const location of data.locations) {
    sink({
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      speedMs: location.coords.speed !== null && location.coords.speed >= 0 ? location.coords.speed : null,
      heading: location.coords.heading !== null && location.coords.heading >= 0 ? location.coords.heading : null,
      accuracy: location.coords.accuracy,
      ts: location.timestamp,
    });
  }
});

export async function startUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 3,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "RDV Garage is live",
      notificationBody: "Sharing your live location with your crews",
      notificationColor: "#2F6FF2",
    },
  });
}

export async function stopUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
