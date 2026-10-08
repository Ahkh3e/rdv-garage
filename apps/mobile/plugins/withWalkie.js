const { withAndroidManifest } = require("expo/config-plugins");

const SERVICE = "app.notifee.core.ForegroundService";

// The walkie-talkie keeps the microphone service running in the background, so the foreground service that carries its
// "In a room" notification must be declared with the microphone type (Android 14 and newer require it).
module.exports = function withWalkie(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] ?? "http://schemas.android.com/tools";
    const app = manifest.application[0];
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: {
        "android:name": SERVICE,
        "android:foregroundServiceType": "microphone",
        "android:exported": "false",
        "tools:replace": "android:foregroundServiceType",
      },
    });
    return cfg;
  });
};
