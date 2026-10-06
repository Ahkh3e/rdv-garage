import { existsSync, readFileSync } from "node:fs";

export type OpsEnvironment = "development" | "test" | "production";

export interface OpsConfig {
  environment: OpsEnvironment;
  projectName: string;
  supabaseUrl: string;
  serviceKey: string;
  anonKey: string;
  auditLogPath: string;
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return out;
}

// Reads ./.env.ops, then /etc/rdv-ops/env (root readable, on the operator server), then RDV_OPS_ENV_FILE, then the process environment.
export function loadConfig(env: NodeJS.ProcessEnv = process.env, files?: string[]): OpsConfig {
  const merged: Record<string, string | undefined> = {};
  // Later wins. A file in the current directory is the weakest, so a stray or planted ./.env.ops can never change the
  // environment that /etc/rdv-ops/env sets. An explicitly named file and the real environment win over both.
  const order = files ?? [".env.ops", "/etc/rdv-ops/env", env.RDV_OPS_ENV_FILE ?? ""];
  for (const path of order) {
    if (path && existsSync(path)) Object.assign(merged, parseEnvFile(path));
  }
  Object.assign(merged, env);
  const environment = (merged.OPS_ENVIRONMENT ?? "development") as OpsEnvironment;
  if (!["development", "test", "production"].includes(environment)) throw new Error(`OPS_ENVIRONMENT must be development, test, or production (got ${environment})`);
  const need = (key: string) => {
    const value = merged[key];
    if (!value) throw new Error(`Missing ${key}. See ops/README.md.`);
    return value;
  };
  // The typed project name is the production confirmation, so it must be a real name and not just "production".
  if (environment === "production" && !merged.OPS_PROJECT_NAME) throw new Error("OPS_PROJECT_NAME is required when OPS_ENVIRONMENT is production.");
  return {
    environment,
    projectName: merged.OPS_PROJECT_NAME ?? environment,
    supabaseUrl: need("SUPABASE_URL"),
    serviceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    anonKey: need("SUPABASE_ANON_KEY"),
    auditLogPath: merged.OPS_AUDIT_LOG ?? (environment === "production" ? "/var/log/rdv-ops/audit.log" : "./ops-audit.log"),
  };
}
