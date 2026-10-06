// Local stand-in for Cloudflare Pages: serves web/dist and applies the same rewrites as src/_redirects.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "dist");
const rules = readFileSync(join(dist, "_redirects"), "utf8").split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3)
  .map(([from, to]) => ({ re: new RegExp("^" + from.replace("*", ".*") + "$"), to }));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

createServer((req, res) => {
  let path = new URL(req.url, "http://x").pathname;
  const rule = rules.find((r) => r.re.test(path));
  if (rule) path = rule.to;
  if (path === "/") path = "/index.html";
  const file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  const name = file.split("/").pop();
  res.writeHead(200, { "Content-Type": name === "apple-app-site-association" ? "application/json" : (types[extname(file)] ?? "application/octet-stream") });
  res.end(readFileSync(file));
}).listen(8788, () => console.log("link pages on http://127.0.0.1:8788"));
