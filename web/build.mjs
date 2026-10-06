// Builds web/dist for Cloudflare Pages. Run with Node 24 (it imports the shared safety text straight from the app).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DISCLAIMER_FULL, DISCLAIMER_SHORT, TERMS_VERSION } from "../packages/core/src/legal.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "src");
const dist = resolve(here, "dist");

const env = (key, fallback) => process.env[key] ?? fallback;
const config = {
  supabaseUrl: env("SUPABASE_URL", "http://127.0.0.1:54321"),
  supabaseKey: env("SUPABASE_PUBLISHABLE_KEY", ""),
  appStoreUrl: env("APP_STORE_URL", "https://apps.apple.com/app/rdv-garage/id0000000000"),
  playUrl: env("PLAY_STORE_URL", "https://play.google.com/store/apps/details?id=app.rdvgarage.mobile"),
  disclaimer: DISCLAIMER_SHORT,
  termsVersion: TERMS_VERSION,
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(src, dist, { recursive: true });

writeFileSync(resolve(dist, "config.js"), `window.RDV = ${JSON.stringify(config)};\n`);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const terms = DISCLAIMER_FULL.map((d, i) => `<div class="card"><h2>${i + 1}. ${esc(d.title)}</h2><p>${esc(d.body)}</p></div>`).join("\n");
writeFileSync(
  resolve(dist, "terms.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RDV Garage safety terms</title><meta name="theme-color" content="#0A0A0B"><link rel="stylesheet" href="/assets/styles.css"></head><body><main><div class="eyebrow">Version ${esc(TERMS_VERSION)}</div><h1>Safety terms</h1><p>Working draft. These terms must be reviewed by a lawyer before launch.</p>${terms}</main></body></html>\n`,
);

const patch = (file, replacements) => {
  const path = resolve(dist, file);
  let text = readFileSync(path, "utf8");
  for (const [from, to] of Object.entries(replacements)) text = text.replaceAll(from, to);
  writeFileSync(path, text);
};
patch(".well-known/apple-app-site-association", { __APPLE_TEAM_ID__: env("APPLE_TEAM_ID", "TEAMID0000") });
patch(".well-known/assetlinks.json", { __ANDROID_SHA256_FINGERPRINT__: env("ANDROID_SHA256_FINGERPRINT", "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00") });
console.log("built", dist);
