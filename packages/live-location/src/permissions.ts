import { Alert, Linking, Platform } from "react-native";
import * as Location from "expo-location";

export type PermissionResult = "ok" | "foreground_only" | "denied";

function confirm(title: string, message: string, action = "Continue"): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ]),
  );
}

// Foreground permission first, then the upgrade to background (Always on iPhone). Asked on the first Go live.
export async function ensureLocationPermission(): Promise<PermissionResult> {
  let fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== "granted") return "denied";
  }
  let bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status === "granted") return "ok";
  const message =
    Platform.OS === "ios"
      ? "To keep sharing while your phone is locked or RDV Garage is in the background, choose Always Allow on the next screen. Location is only shared while you are live, and only with the crews you pick."
      : "To keep sharing while RDV Garage is in the background, allow location all the time on the next screen. A notification shows while you are live. Location is only shared with the crews you pick.";
  if (!(await confirm("Share your location while you drive", message))) return "foreground_only";
  bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === "granted" ? "ok" : "foreground_only";
}

export function openSettings(): void {
  Linking.openSettings().catch(() => undefined);
}
