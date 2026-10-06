#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(process.execPath, ["--import", "tsx", resolve(root, "src/cli.ts"), ...process.argv.slice(2)], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);
