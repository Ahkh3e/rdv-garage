import { createInterface } from "node:readline/promises";
import type { OpsConfig } from "./config";

export const READ_ONLY_COMMANDS = new Set(["user show", "invite list", "status"]);

export interface GuardOptions {
  production?: boolean;
  confirmProject?: string;
}

export class GuardError extends Error {}

// Production needs an explicit flag and the typed project name for everything except the read-only commands.
export async function guard(config: OpsConfig, command: string, options: GuardOptions, ask: (q: string) => Promise<string> = prompt): Promise<void> {
  if (config.environment !== "production" || READ_ONLY_COMMANDS.has(command)) return;
  if (!options.production) throw new GuardError(`Refusing to run "${command}" in production without --production.`);
  const typed = options.confirmProject ?? (await ask(`Type the project name (${config.projectName}) to continue: `));
  if (typed.trim() !== config.projectName) throw new GuardError("Project name did not match. Nothing was changed.");
}

async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new GuardError("Production commands need --confirm-project when there is no terminal.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

// Synthetic users may only hang under a synthetic inviter in production.
export function assertInviterAllowed(config: OpsConfig, inviterIsSynthetic: boolean): void {
  if (config.environment === "production" && !inviterIsSynthetic) {
    throw new GuardError("In production, --invited-by must be a synthetic user.");
  }
}

// In production a synthetic crew may only be owned by a synthetic user.
export function assertSyntheticCrewOwner(config: OpsConfig, ownerIsSynthetic: boolean): void {
  if (config.environment === "production" && !ownerIsSynthetic) {
    throw new GuardError("In production, a synthetic crew must be owned by a synthetic user.");
  }
}

export function assertCrewAddAllowed(config: OpsConfig, crewOwnerIsSynthetic: boolean, userIsSynthetic: boolean): void {
  if (config.environment === "production" && userIsSynthetic && !crewOwnerIsSynthetic) {
    throw new GuardError("In production, synthetic users cannot be added to a crew owned by a real user.");
  }
}
