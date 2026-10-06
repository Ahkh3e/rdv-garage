// Live, clickable view of an iOS simulator in the browser, for Macs where the Simulator window is not available.
// Usage: AXE=/path/to/axe node scripts/sim-view.mjs <simulator udid> [port]
// It shows a fresh screenshot a couple of times a second. Click to tap, drag to swipe, type to type. Local only.
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const udid = process.argv[2];
const port = Number(process.argv[3] ?? 8789);
const axe = process.env.AXE ?? "axe";
const scale = Number(process.env.SCALE ?? 3);
if (!udid) throw new Error("usage: node scripts/sim-view.mjs <simulator udid> [port]");

const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { encoding: "buffer", maxBuffer: 20_000_000 }, (error, stdout) => resolve(error ? null : stdout)));
let busy = false;
let last = null;

async function frame() {
  if (busy) return last;
  busy = true;
  const file = join(tmpdir(), `sim-view-${udid}.jpg`);
  await run("xcrun", ["simctl", "io", udid, "screenshot", "--type=jpeg", file]);
  try {
    const out = readFileSync(file);
    if (out.length > 1000) last = out;
  } catch {
    // keep the previous frame
  }
  busy = false;
  return last;
}

const page = `<!doctype html><meta charset=utf-8><title>Simulator</title>
<style>body{margin:0;background:#111;color:#aaa;font:14px system-ui;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}
img{max-height:92vh;border-radius:28px;box-shadow:0 0 0 2px #333;cursor:pointer;user-select:none;-webkit-user-drag:none}</style>
<div>Click to tap, drag to swipe, type to type. <button onclick="k(40)">Return</button> <button onclick="k(42)">Backspace</button> <button onclick="h('home')">Home</button></div>
<img id=s src="/frame"><script>
const img=document.getElementById('s');let down=null,buf='',t=null;
const pt=e=>{const r=img.getBoundingClientRect();return[(e.clientX-r.left)/r.width*img.naturalWidth/${scale},(e.clientY-r.top)/r.height*img.naturalHeight/${scale}]};
const post=(p,b)=>fetch(p,{method:'POST',body:JSON.stringify(b)});
async function tick(){try{const r=await fetch('/frame?'+Date.now());if(r.ok){const u=URL.createObjectURL(await r.blob());const old=img.src;img.src=u;if(old.startsWith('blob:'))URL.revokeObjectURL(old);}}catch{}setTimeout(tick,350)}
img.onload=()=>{};tick();
img.onmousedown=e=>{down=pt(e);e.preventDefault()};
img.onmouseup=e=>{if(!down)return;const u=pt(e);const d=Math.hypot(u[0]-down[0],u[1]-down[1]);post(d<8?'/tap':'/swipe',d<8?{x:u[0],y:u[1]}:{x1:down[0],y1:down[1],x2:u[0],y2:u[1]});down=null};
window.k=c=>post('/key',{code:c});window.h=n=>post('/button',{name:n});
document.onkeydown=e=>{if(e.metaKey||e.ctrlKey)return;if(e.key==='Backspace'){k(42);e.preventDefault();return}if(e.key==='Enter'){k(40);e.preventDefault();return}
if(e.key.length===1){buf+=e.key;clearTimeout(t);t=setTimeout(()=>{post('/type',{text:buf});buf=''},120);e.preventDefault()}};
</script>`;

const body = (req) => new Promise((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : {})); });
const sh = (args) => run(axe, [...args, "--udid", udid]);

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/frame") {
    const f = await frame();
    if (!f) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" });
    return res.end(f);
  }
  if (req.method === "POST") {
    const b = await body(req);
    if (url.pathname === "/tap") await sh(["tap", "-x", String(Math.round(b.x)), "-y", String(Math.round(b.y))]);
    if (url.pathname === "/swipe") await sh(["swipe", "--start-x", String(Math.round(b.x1)), "--start-y", String(Math.round(b.y1)), "--end-x", String(Math.round(b.x2)), "--end-y", String(Math.round(b.y2))]);
    if (url.pathname === "/type") await sh(["type", b.text]);
    if (url.pathname === "/key") await sh(["key", String(b.code)]);
    if (url.pathname === "/button") await sh(["button", b.name]);
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(page);
}).listen(port, "127.0.0.1", () => console.log(`simulator view on http://127.0.0.1:${port}`));
