import { randomBytes, randomInt } from "node:crypto";
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
    try {
      writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result: "refused", detail: (error as Error).message });
    } catch (auditError) {
      console.error(`audit result not written: ${(auditError as Error).message}`);
    }
    throw error;
  }
  const ctx = makeCtx({ dryRun: options.dryRun }, cfg);
  // Record the attempt before doing anything. If the log cannot be written in production, nothing runs.
  writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result: "started" });
  const finish = (result: "ok" | "error" | "dry-run", detail?: string) => {
    try {
      writeAudit(cfg.auditLogPath, { environment: cfg.environment, command: name, args, result, detail });
    } catch (auditError) {
      // The work is already done or already failed; do not report the wrong outcome because the log was unwritable.
      console.error(`audit result not written: ${(auditError as Error).message}`);
    }
  };
  try {
    const out = await body(ctx);
    finish(ctx.dryRun ? "dry-run" : "ok");
    return out;
  } catch (error) {
    finish("error", (error as Error).message);
    throw error;
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Invite codes and crew links are real credentials, so they come from the system's secure random source.
export function randomCode(length: number): string {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
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
