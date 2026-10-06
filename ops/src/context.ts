import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "./audit";
import { loadConfig, type OpsConfig } from "./config";
import { guard, type GuardOptions } from "./guard";

export interface Ctx {
  config: OpsConfig;
  admin: SupabaseClient;
  dryRun: boolean;
  log(message: string): void;
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export function makeCtx(options: { dryRun?: boolean } = {}, config: OpsConfig = loadConfig()): Ctx {
  return {
    config,
    admin: createClient(config.supabaseUrl, config.serviceKey, clientOptions),
    dryRun: !!options.dryRun,
    log: (message) => console.log(message),
  };
}

export function anonClient(ctx: Ctx): SupabaseClient {
  return createClient(ctx.config.supabaseUrl, ctx.config.anonKey, clientOptions);
}

// Runs one command: guard, audit, and error handling in one place.
export async function runCommand<T>(
  name: string,
  args: Record<string, unknown>,
  options: GuardOptions & { dryRun?: boolean },
  body: (ctx: Ctx) => Promise<T>,
  config?: OpsConfig,
): Promise<T | undefined> {
  const cfg = config ?? loadConfig();
  try {
    await guard(cfg, name, options);
  } catch (error) {
    writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result: "refused", detail: (error as Error).message });
    throw error;
  }
  const ctx = makeCtx({ dryRun: options.dryRun }, cfg);
  try {
    const out = await body(ctx);
    writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result: ctx.dryRun ? "dry-run" : "ok" });
    return out;
  } catch (error) {
    writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result: "error", detail: (error as Error).message });
    throw error;
  }
}

export function randomToken(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

export function randomPassword(): string {
  return randomBytes(18).toString("base64url");
}

export function randomHandle(): string {
  return `sim_${randomBytes(4).toString("hex")}`;
}

export function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
