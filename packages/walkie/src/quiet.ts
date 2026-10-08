// livekit-client logs these at error level when a socket closes the way it is meant to on a normal leave or a kick.
// They are not failures: the controller rejoins on its own. Keep the list to what was seen, so real failures stay visible.
export const EXPECTED_LIVEKIT_LOGS: RegExp[] = [/error reading from signal stream/i, /ping timeout triggered/i];

export const isExpectedLiveKitLog = (message: string) => EXPECTED_LIVEKIT_LOGS.some((p) => p.test(message));

const FILTERED = Symbol.for("rdv.expectedLogFilter");

// Wraps console.error and console.warn once so expected livekit lines never reach Metro or the error overlay. Everything else passes through.
// livekit-client logs "ping timeout triggered" at warn level, and binds the console methods when it loads, so this must run before it is required.
export function installExpectedLogFilter(target: { error: (...args: any[]) => void; warn?: (...args: any[]) => void }) {
  for (const level of ["error", "warn"] as const) {
    const current = target[level] as ((...args: any[]) => void) & { [FILTERED]?: true } | undefined;
    if (!current || current[FILTERED]) continue;
    const wrapped = ((...args: any[]) => {
      if (typeof args[0] === "string" && isExpectedLiveKitLog(args[0])) return;
      current.apply(target, args);
    }) as typeof current;
    wrapped[FILTERED] = true;
    target[level] = wrapped;
  }
}
