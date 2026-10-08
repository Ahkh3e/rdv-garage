const { withEntitlementsPlist } = require("expo/config-plugins");

// Free personal teams cannot provision Push Notifications, so the aps-environment entitlement added by expo-notifications and expo-live-activity must go.
module.exports = function withFreeAppleId(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    delete cfg.modResults["com.apple.developer.associated-domains"];
    return cfg;
  });
};
