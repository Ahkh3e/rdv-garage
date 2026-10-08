const { withXcodeProject } = require("expo/config-plugins");

// Expo writes DEVELOPMENT_TEAM for the app target from ios.appleTeamId; the Live Activity extension target is added by expo-live-activity without one.
// Register this plugin before expo-live-activity so its mod runs after the extension target exists.
module.exports = function withExtensionTeam(config, { targetName = "LiveActivity", teamId } = {}) {
  const team = teamId ?? config.ios?.appleTeamId;
  if (!team) return config;
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const targets = project.pbxNativeTargetSection();
    for (const key of Object.keys(targets)) {
      const t = targets[key];
      if (typeof t !== "object" || t.name !== `"${targetName}"` && t.name !== targetName) continue;
      const list = project.pbxXCConfigurationList()[t.buildConfigurationList];
      const configs = project.pbxXCBuildConfigurationSection();
      for (const ref of list.buildConfigurations) configs[ref.value].buildSettings.DEVELOPMENT_TEAM = team;
    }
    return cfg;
  });
};
