import { buildConfig } from "../app.config";

const withFreeAppleId = require("../plugins/withFreeAppleId");

const pluginNames = (c: ReturnType<typeof buildConfig>) => (c.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));

describe("app config", () => {
  const base = buildConfig({});

  it("keeps the default build unchanged", () => {
    expect(base.ios?.bundleIdentifier).toBe("app.rdvgarage.mobile");
    expect(base.ios?.associatedDomains).toEqual(["applinks:links.rdvgarage.example"]);
    expect(base.ios?.entitlements).toEqual({ "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.mobile"] });
    expect(pluginNames(base)).not.toContain("./plugins/withFreeAppleId");
    expect(buildConfig({ RDV_FREE_APPLE_ID: "0" })).toEqual(base);
  });

  it("drops associated domains and strips push for a free Apple ID, changing nothing else", () => {
    const free = buildConfig({ RDV_FREE_APPLE_ID: "1" });
    expect(free.ios?.associatedDomains).toBeUndefined();
    expect(pluginNames(free)).toContain("./plugins/withFreeAppleId");
    const strip = (c: typeof free) => ({ ...c, ios: { ...c.ios, associatedDomains: undefined }, plugins: pluginNames(c).filter((p) => p !== "./plugins/withFreeAppleId") });
    expect(strip(free)).toEqual(strip(base));
  });

  it("overrides the iOS bundle id and keychain group but not Android", () => {
    const c = buildConfig({ RDV_BUNDLE_ID: "app.rdvgarage.ahmed" });
    expect(c.ios?.bundleIdentifier).toBe("app.rdvgarage.ahmed");
    expect(c.ios?.entitlements).toEqual({ "keychain-access-groups": ["$(AppIdentifierPrefix)app.rdvgarage.ahmed"] });
    expect(c.android?.package).toBe("app.rdvgarage.mobile");
    expect({ ...c, ios: undefined }).toEqual({ ...base, ios: undefined });
  });

  it("uses the link domain in associated domains", () => {
    expect(buildConfig({ EXPO_PUBLIC_LINK_DOMAIN: "links.example.org" }).ios?.associatedDomains).toEqual(["applinks:links.example.org"]);
  });

  it("the free plugin removes the push and associated domains entitlements only", async () => {
    const out = withFreeAppleId({ name: "x", slug: "x" });
    const mod = out.mods.ios.entitlements;
    const res = await mod({
      modResults: { "aps-environment": "development", "com.apple.developer.associated-domains": ["applinks:a"], "keychain-access-groups": ["k"] },
      modRequest: {},
    });
    expect(res.modResults).toEqual({ "keychain-access-groups": ["k"] });
  });
});
