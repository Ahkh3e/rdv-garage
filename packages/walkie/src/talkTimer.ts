export const TALK_LIMIT_MS = 60_000;

export interface TalkTimer {
  start(): void;
  stop(): void;
  active(): boolean;
}

// Closes a held microphone by itself after the limit, so a dropped or jammed phone does not stay open.
export function createTalkTimer(
  onExpire: () => void,
  limitMs = TALK_LIMIT_MS,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): TalkTimer {
  let handle: unknown = null;
  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    start() {
      stop();
      handle = timers.set(() => {
        handle = null;
        onExpire();
      }, limitMs);
    },
    stop,
    active: () => handle !== null,
  };
}
