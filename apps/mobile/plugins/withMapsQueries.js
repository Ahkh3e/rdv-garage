const { withAndroidManifest } = require("expo/config-plugins");

const PACKAGES = ["com.waze", "com.google.android.apps.maps"];
const SCHEMES = ["waze", "google.navigation"];

module.exports = function withMapsQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    const queries = manifest.queries[0] ?? (manifest.queries[0] = {});
    queries.package = queries.package ?? [];
    queries.intent = queries.intent ?? [];
    for (const name of PACKAGES) {
      if (!queries.package.some((p) => p.$["android:name"] === name)) queries.package.push({ $: { "android:name": name } });
    }
    for (const scheme of SCHEMES) {
      const has = queries.intent.some((i) => (i.data ?? []).some((d) => d.$["android:scheme"] === scheme));
      if (!has) queries.intent.push({ action: [{ $: { "android:name": "android.intent.action.VIEW" } }], data: [{ $: { "android:scheme": scheme } }] });
    }
    return cfg;
  });
};
