// Drives a booted iOS simulator along a road-snapped loop.
// usage: node scripts/sim-phone.mjs <udid> <city|highway|loopA|loopB> [speed m/s=14] [start fraction 0..1]
import { spawnSync } from "node:child_process";
import { ROADS } from "../ops/src/roads.ts";

const [udid, name = "loopA", speed = "14", startAt = "0"] = process.argv.slice(2);
const road = ROADS[name];
if (!udid || !road) {
  console.error("usage: node scripts/sim-phone.mjs <udid> <city|highway|loopA|loopB> [speed m/s] [start fraction]");
  process.exit(1);
}
const offset = Math.floor(road.length * Math.min(0.99, Math.max(0, Number(startAt))));
const ordered = [...road.slice(offset), ...road.slice(0, offset), road[offset]];
// Fewer, evenly spaced waypoints keep the command short; the roads are already dense.
const picked = [];
let last = null;
for (const p of ordered) {
  if (!last || Math.hypot((p.lat - last.lat) * 111320, (p.lng - last.lng) * 80000) >= 8) {
    picked.push(p);
    last = p;
  }
}
const args = ["simctl", "location", udid, "start", `--speed=${speed}`, "--interval=0.5", ...picked.map((p) => `${p.lat},${p.lng}`)];
const result = spawnSync("xcrun", args, { stdio: "inherit" });
console.log(`${name}: ${picked.length} waypoints at ${speed} m/s`);
process.exit(result.status ?? 0);
