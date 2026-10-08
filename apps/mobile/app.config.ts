import type { ExpoConfig } from "expo/config";

type Env = Record<string, string | undefined>;

export function buildConfig(env: Env): ExpoConfig {
const linkDomain = env.EXPO_PUBLIC_LINK_DOMAIN ?? "links.rdvgarage.example";
const freeAppleId = env.RDV_FREE_APPLE_ID === "1";
const iosBundleId = env.RDV_BUNDLE_ID || "app.rdvgarage.mobile";

const config: ExpoConfig = {
  name: "RDV Garage",
  slug: "rdv-garage",
  scheme: "rdvgarage",
  version: "0.0.1",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  backgroundColor: "#080A0F",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: false,
    bundleIdentifier: iosBundleId,
    ...(freeAppleId ? {} : { associatedDomains: [`applinks:${linkDomain}`] }),
    // Needed so the secure store (keychain) works in simulator builds as well as device builds.
    entitlements: { "keychain-access-groups": [`$(AppIdentifierPrefix)${iosBundleId}`] },
    infoPlist: {
      UIBackgroundModes: ["location", "audio", "voip"],
      LSApplicationQueriesSchemes: ["waze", "comgooglemaps"],
      NSLocationWhenInUseUsageDescription: "RDV Garage shows you on the map and follows you while you drive.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "RDV Garage shares your live position with the crews you choose, even when the app is in the background, but only while you are live.",
      NSPhotoLibraryUsageDescription: "Choose a profile photo.",
      NSMicrophoneUsageDescription: "Rendezview uses the microphone only while you hold Talk in a room, so the people in the room can hear you.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.rdvgarage.mobile",
    adaptiveIcon: {
      backgroundColor: "#080A0F",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
      "FOREGROUND_SERVICE_MICROPHONE",
    ],
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: linkDomain, pathPrefix: "/i/" }, { scheme: "https", host: linkDomain, pathPrefix: "/c/" }, { scheme: "https", host: linkDomain, pathPrefix: "/reset" }, { scheme: "https", host: linkDomain, pathPrefix: "/confirm" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  plugins: [
    ...(freeAppleId ? ["./plugins/withFreeAppleId"] : []),
    "expo-secure-store",
    ["expo-notifications", { color: "#2F6FF2" }],
    "expo-live-activity",
    "expo-font",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 200, backgroundColor: "#080A0F" }],
    "expo-dev-client",
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "RDV Garage shares your live position with the crews you choose, even when the app is in the background, but only while you are live.",
        locationWhenInUsePermission: "RDV Garage shows you on the map and follows you while you drive.",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    ["expo-image-picker", { photosPermission: "Choose a profile photo." }],
    "@maplibre/maplibre-react-native",
    "./plugins/withMapsQueries",
    "@livekit/react-native-expo-plugin",
    "./plugins/withWalkie",
  ],
  extra: {
    supabaseUrl: env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    linkDomain,
  },
};

return config;
}

export default buildConfig(process.env);
