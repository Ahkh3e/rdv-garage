import { buildConfig } from "../app.config";

const { execFileSync } = require("child_process");
const withExtensionTeam = require("../plugins/withExtensionTeam");

const pluginNames = (c: ReturnType<typeof buildConfig>) => (c.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));

const introspect = (env: Record<string, string>) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("RDV_")));
  const out = execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
    cwd: process.cwd(),
    env: { ...clean, ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
};

describe("buildConfig", () => {
  const base = buildConfig({});

  it("defaults to the app.rdvgarage.mobile bundle id, associated domains and keychain group", () => {
    expect(base.ios?.bundleIdentifier).toBe("app.rdvgarage.mobile");
    expect(base.ios?.associatedDomains).toEqual(["applinks:links.rdvgarage.example"]);
    expect(base.ios?.entitlements).toEqual({ "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.mobile"] });
    expect(base.ios?.appleTeamId).toBeUndefined();
    expect(pluginNames(base)).not.toContain("./plugins/withFreeAppleId");
    expect(buildConfig({ RDV_FREE_APPLE_ID: "0" })).toEqual(base);
  });

  it("free mode drops associated domains and adds only the free plugin", () => {
    const free = buildConfig({ RDV_FREE_APPLE_ID: "1" });
    expect(free.ios?.associatedDomains).toBeUndefined();
    expect(pluginNames(free)[0]).toBe("./plugins/withFreeAppleId");
    const strip = (c: typeof free) => ({ ...c, ios: { ...c.ios, associatedDomains: undefined }, plugins: pluginNames(c).filter((p) => p !== "./plugins/withFreeAppleId") });
    expect(strip(free)).toEqual(strip(base));
  });

  it("RDV_BUNDLE_ID changes the iOS id and keychain group only", () => {
    const c = buildConfig({ RDV_BUNDLE_ID: "app.rdvgarage.ahmed" });
    expect(c.ios?.bundleIdentifier).toBe("app.rdvgarage.ahmed");
    expect(c.ios?.entitlements).toEqual({ "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.ahmed"] });
    expect(c.android?.package).toBe("app.rdvgarage.mobile");
    expect({ ...c, ios: undefined }).toEqual({ ...base, ios: undefined });
  });

  it("RDV_TEAM_ID sets appleTeamId and passes the team to the extension plugin", () => {
    const c = buildConfig({ RDV_TEAM_ID: "ABCDE12345" });
    expect(c.ios?.appleTeamId).toBe("ABCDE12345");
    expect(c.plugins).toContainEqual(["./plugins/withExtensionTeam", { teamId: "ABCDE12345" }]);
    expect(pluginNames(c).indexOf("./plugins/withExtensionTeam")).toBeLessThan(pluginNames(c).indexOf("expo-live-activity"));
  });

  it("uses the link domain in associated domains", () => {
    expect(buildConfig({ EXPO_PUBLIC_LINK_DOMAIN: "links.example.org" }).ios?.associatedDomains).toEqual(["applinks:links.example.org"]);
  });
});

describe("withExtensionTeam", () => {
  const fakeProject = () => {
    const configs: Record<string, { buildSettings: Record<string, string> }> = { a: { buildSettings: {} }, b: { buildSettings: {} }, c: { buildSettings: {} } };
    return {
      configs,
      pbxNativeTargetSection: () => ({ T1: { name: '"LiveActivity"', buildConfigurationList: "L1" }, T2: { name: "RDVGarage", buildConfigurationList: "L2" }, T1_comment: "LiveActivity" }),
      pbxXCConfigurationList: () => ({ L1: { buildConfigurations: [{ value: "a" }, { value: "b" }] }, L2: { buildConfigurations: [{ value: "c" }] } }),
      pbxXCBuildConfigurationSection: () => configs,
    };
  };
  const run = async (config: object, options?: object) => {
    const project = fakeProject();
    const out = withExtensionTeam(config, options);
    if (out.mods) await out.mods.ios.xcodeproj({ ...out, modResults: project, modRequest: {} });
    return project.configs;
  };

  it("sets the team on the named extension target only", async () => {
    const c = await run({ name: "x", slug: "x" }, { teamId: "ABCDE12345" });
    expect(c.a!.buildSettings.DEVELOPMENT_TEAM).toBe("ABCDE12345");
    expect(c.b!.buildSettings.DEVELOPMENT_TEAM).toBe("ABCDE12345");
    expect(c.c!.buildSettings.DEVELOPMENT_TEAM).toBeUndefined();
  });

  it("targetName option selects another target and no team changes nothing", async () => {
    const other = await run({ name: "x", slug: "x" }, { teamId: "ABCDE12345", targetName: "RDVGarage" });
    expect(other.c!.buildSettings.DEVELOPMENT_TEAM).toBe("ABCDE12345");
    expect(other.a!.buildSettings.DEVELOPMENT_TEAM).toBeUndefined();
    const none = await run({ name: "x", slug: "x" });
    expect(Object.values(none).every((v) => v.buildSettings.DEVELOPMENT_TEAM === undefined)).toBe(true);
  });
});

describe("generated entitlements (real Expo plugin pipeline)", () => {
  it("default config requests associated domains and push, and no team", () => {
    const c = introspect({});
    expect(c.ios.entitlements["com.apple.developer.associated-domains"]).toBeDefined();
    expect(c.ios.entitlements["aps-environment"]).toBe("development");
  });

  it("RDV_FREE_APPLE_ID=1 leaves neither associated domains nor push on the app, nor on the Live Activity extension", () => {
    const c = introspect({ RDV_FREE_APPLE_ID: "1", RDV_BUNDLE_ID: "app.rdvgarage.ahmed" });
    expect(c.ios.entitlements).toEqual({ "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.ahmed"] });
    const ext = c.extra.eas.build.experimental.ios.appExtensions;
    expect(ext).toEqual([{ targetName: "LiveActivity", bundleIdentifier: "app.rdvgarage.ahmed.LiveActivity", entitlements: {} }]);
  });
});

describe("iOS scene lifecycle (real Expo plugin pipeline)", () => {
  const manifest = { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" }] } };

  it("enables expo-build-properties ios.enableSceneSupport", () => {
    expect(buildConfig({}).plugins).toContainEqual(["expo-build-properties", { ios: { enableSceneSupport: true } }]);
  });

  it.each<Record<string, string>>([{}, { RDV_FREE_APPLE_ID: "1" }])("generated Info.plist has the scene manifest (%j)", (env) => {
    expect(introspect(env).ios.infoPlist.UIApplicationSceneManifest).toEqual(manifest);
  });
});
