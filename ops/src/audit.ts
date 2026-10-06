import { appendFileSync } from "node:fs";
import { userInfo } from "node:os";

const SECRET_KEY = /password|secret|token|key|credential/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]));
  }
  return value;
}

export interface AuditEntry {
  ts: string;
  operator: string;
  environment: string;
  command: string;
  args: unknown;
  result: "ok" | "error" | "refused" | "dry-run";
  detail?: string;
}

export function writeAudit(path: string, entry: Omit<AuditEntry, "ts" | "operator">): AuditEntry {
  const full: AuditEntry = { ts: new Date().toISOString(), operator: safeUser(), ...entry, args: redact(entry.args) };
  try {
    appendFileSync(path, JSON.stringify(full) + "\n", { mode: 0o640 });
  } catch (error) {
    // The log must never be silently skipped on a real server.
    if (entry.environment === "production") throw new Error(`Cannot write audit log ${path}: ${(error as Error).message}`);
    console.warn(`audit log not written (${(error as Error).message})`);
  }
  return full;
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}
