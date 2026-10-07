import { Alert, Linking, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { APP_NAMES, type MapsApp, type OS } from "./apps";
import { createHandoff } from "./handoff";
import { createMapsPrefs } from "./prefs";

export const os: OS = Platform.OS === "ios" ? "ios" : "android";

export const prefs = createMapsPrefs({
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
});

const pick = ({ missing, options }: { missing: MapsApp; options: MapsApp[] }) =>
  new Promise<MapsApp | null>((resolve) =>
    Alert.alert(
      `${APP_NAMES[missing]} isn't installed`,
      "Open directions in another maps app?",
      [
        ...options.map((app) => ({ text: APP_NAMES[app], onPress: () => resolve(app) })),
        { text: "Cancel", style: "cancel" as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    ),
  );

const remember = (app: MapsApp) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(`Use ${APP_NAMES[app]} from now on?`, "You can change this in Me, Maps app.", [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: "Use it", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

export const handoff = createHandoff({
  os,
  ready: () => prefs.ready,
  getPreferred: () => prefs.store.get(),
  setPreferred: prefs.set,
  canOpen: (url) => Linking.canOpenURL(url),
  open: (url) => Linking.openURL(url),
  choose: pick,
  confirmRemember: remember,
});
