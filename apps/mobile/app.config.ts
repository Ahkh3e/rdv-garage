import type { ExpoConfig } from "expo/config";

const linkDomain = process.env.EXPO_PUBLIC_LINK_DOMAIN ?? "links.rdvgarage.example";
const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY ?? "";

const config: ExpoConfig = {
  name: "RDV Garage",
  slug: "rdv-garage",
  scheme: "rdvgarage",
  version: "0.0.1",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  backgroundColor: "#0A0A0B",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: false,
    bundleIdentifier: "app.rdvgarage.mobile",
    associatedDomains: [`applinks:${linkDomain}`],
    // Needed so the secure store (keychain) works in simulator builds as well as device builds.
    entitlements: { "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.mobile"] },
    infoPlist: {
      UIBackgroundModes: ["location"],
      NSLocationWhenInUseUsageDescription: "RDV Garage shows you on the map and follows you while you drive.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "RDV Garage shares your live position with the crews you choose, even when the app is in the background, but only while you are live.",
      NSPhotoLibraryUsageDescription: "Choose a profile photo.",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "app.rdvgarage.mobile",
    adaptiveIcon: {
      backgroundColor: "#0A0A0B",
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
    "expo-secure-store",
    "expo-font",
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 200, backgroundColor: "#0A0A0B" }],
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
    ["react-native-maps", { androidGoogleMapsApiKey: googleMapsKey }],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    linkDomain,
  },
};

export default config;
