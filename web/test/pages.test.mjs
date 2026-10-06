import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, ResourceLoader } from "jsdom";
import { describe, expect, it } from "vitest";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const HOST = "https://links.test";

class Loader extends ResourceLoader {
  constructor(userAgent) {
    super({ userAgent });
  }
  fetch(url) {
    const path = new URL(url).pathname;
    try {
      return Promise.resolve(readFileSync(resolve(dist, "." + path)));
    } catch {
      return Promise.resolve(Buffer.from(""));
    }
  }
}

async function open(file, path, { ua = IOS, rpcStatus = "valid", fetchImpl } = {}) {
  const calls = [];
  const copied = [];
  const dom = await JSDOM.fromFile(resolve(dist, file), {
    url: HOST + path,
    runScripts: "dangerously",
    resources: new Loader(ua),
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => void copied.push(t) }, configurable: true });
      window.fetch = fetchImpl ?? (async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/rpc/check_invite")) return { ok: true, json: async () => rpcStatus };
        return { ok: true, json: async () => ({}) };
      });
    },
  });
  await new Promise((r) => dom.window.addEventListener("load", r));
  await new Promise((r) => setTimeout(r, 50));
  const visible = (id) => !dom.window.document.getElementById(id).classList.contains("hidden");
  return { dom, calls, copied, visible, el: (id) => dom.window.document.getElementById(id) };
}

const CODE = "ABC234DEF567";

describe("invite page", () => {
  it("on iPhone shows the invite, copies the code, and links to the App Store", async () => {
    const p = await open("invite.html", `/i/${CODE}`);
    expect(p.visible("valid")).toBe(true);
    expect(p.visible("invalid")).toBe(false);
    expect(p.el("code").textContent).toBe(CODE);
    expect(p.el("open").href).toBe(`rdvgarage://i/${CODE}`);
    expect(p.el("store").href).toContain("apps.apple.com");
    expect(p.copied).toContain(CODE);
    expect(p.visible("hint")).toBe(true);
    const call = p.calls.find((c) => c.url.includes("check_invite"));
    expect(JSON.parse(call.init.body)).toEqual({ p_code: CODE });
    expect(call.init.headers["Content-Profile"]).toBe("referral");
  });

  it("on Android carries the code in the Play Store referrer", async () => {
    const p = await open("invite.html", `/i/${CODE}`, { ua: ANDROID });
    expect(p.visible("valid")).toBe(true);
    expect(p.el("store").href).toContain("play.google.com");
    expect(decodeURIComponent(p.el("store").href)).toContain(`referrer=invite=${CODE}`);
    expect(p.copied.length).toBe(0);
  });

  it("on a desktop says it is a mobile app", async () => {
    const p = await open("invite.html", `/i/${CODE}`, { ua: DESKTOP });
    expect(p.visible("desktop")).toBe(true);
    expect(p.visible("open")).toBe(false);
  });

  it.each([
    ["expired", /expired/i],
    ["revoked", /no longer active/i],
    ["disabled", /no longer active/i],
    ["invalid", /don't recognize/i],
  ])("shows a clear message for a %s invite", async (status, pattern) => {
    const p = await open("invite.html", `/i/${CODE}`, { rpcStatus: status });
    expect(p.visible("invalid")).toBe(true);
    expect(p.visible("valid")).toBe(false);
    expect(p.el("reason").textContent).toMatch(pattern);
  });

  it("shows an error when the check cannot be made", async () => {
    const p = await open("invite.html", `/i/${CODE}`, { fetchImpl: async () => { throw new Error("offline"); } });
    expect(p.visible("error")).toBe(true);
  });

  it("shows the short safety disclaimer", async () => {
    const p = await open("invite.html", `/i/${CODE}`);
    expect(p.el("disclaimer").textContent).toMatch(/obey all laws/i);
  });
});

describe("crew, confirm, and reset pages", () => {
  it("crew link opens the app and explains the invite requirement", async () => {
    const p = await open("crew.html", "/c/XYZ123");
    expect(p.el("open").href).toBe("rdvgarage://c/XYZ123");
    expect(p.dom.window.document.body.textContent).toMatch(/invite first/i);
  });

  it("confirm page offers the app", async () => {
    const p = await open("confirm.html", "/confirm", { ua: IOS });
    expect(p.dom.window.document.body.textContent).toMatch(/Email confirmed/);
    expect(p.visible("store")).toBe(true);
  });

  it("reset page without a recovery token says the link expired", async () => {
    const p = await open("reset.html", "/reset");
    expect(p.visible("expired")).toBe(true);
    expect(p.visible("form")).toBe(false);
  });

  it("reset page hands off to the app and can set the password on the page", async () => {
    const p = await open("reset.html", "/reset#access_token=a.b.c&refresh_token=r&type=recovery");
    expect(p.visible("form")).toBe(true);
    expect(p.visible("app")).toBe(true);
    expect(p.el("open").href).toBe("rdvgarage://reset#access_token=a.b.c&refresh_token=r&type=recovery");

    p.el("pw").value = "short";
    p.el("save").click();
    await new Promise((r) => setTimeout(r, 30));
    expect(p.el("err").textContent).toMatch(/8 characters/);
    expect(p.calls.length).toBe(0);

    p.el("pw").value = "a-long-enough-password";
    p.el("save").click();
    await new Promise((r) => setTimeout(r, 60));
    const put = p.calls.find((c) => c.url.endsWith("/auth/v1/user"));
    expect(put.init.method).toBe("PUT");
    expect(put.init.headers.Authorization).toBe("Bearer a.b.c");
    expect(JSON.parse(put.init.body)).toEqual({ password: "a-long-enough-password" });
    const revoke = p.calls.find((c) => c.url.endsWith("/rpc/revoke_other_sessions"));
    expect(revoke.init.headers["Content-Profile"]).toBe("accounts");
    expect(p.visible("done")).toBe(true);
  });
});

describe("static files", () => {
  const read = (f) => readFileSync(resolve(dist, f), "utf8");
  it("terms page lists every safety term", () => {
    const html = read("terms.html");
    expect(html).toMatch(/You are responsible for your driving/);
    expect(html).toMatch(/Use at your own risk/);
    expect((html.match(/class="card"/g) ?? []).length).toBe(10);
  });
  it("deep link files are valid JSON for the right app ids", () => {
    const aasa = JSON.parse(read(".well-known/apple-app-site-association"));
    expect(aasa.applinks.details[0].appIDs[0]).toMatch(/\.app\.rdvgarage\.mobile$/);
    expect(aasa.applinks.details[0].components.map((c) => c["/"])).toEqual(["/i/*", "/c/*", "/reset", "/confirm"]);
    const links = JSON.parse(read(".well-known/assetlinks.json"));
    expect(links[0].target.package_name).toBe("app.rdvgarage.mobile");
  });
  it("serves rewrites and headers for Cloudflare Pages", () => {
    expect(read("_redirects")).toMatch(/\/i\/\*\s+\/invite\.html\s+200/);
    expect(read("_headers")).toMatch(/Content-Type: application\/json/);
  });
});
