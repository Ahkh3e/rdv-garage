const { withEntitlementsPlist } = require("expo/config-plugins");

// A free personal team cannot provision Push Notifications. expo-notifications and expo-live-activity add aps-environment.
// Expo runs the mods of later plugins first, so this plugin must be registered before them for its mod to run after theirs.
module.exports = function withFreeAppleId(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
