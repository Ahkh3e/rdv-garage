import { useCallback, useRef, useState } from "react";
import { messageFor } from "./errors";
import { formatDistance, haversineMeters } from "./geo";
import { useShell } from "./shell";
import { useStore } from "./store";

// Runs an async action with loading and error state. Ignores calls while one is in flight.
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setLoading(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        setError(messageFor(e));
        return undefined;
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return { run, loading, error, setError };
}

// How far a point is from the device, as text like "1.2 km", or null while the position is unknown.
export function useDistanceLabel(point: { lat: number; lng: number } | null | undefined): string | null {
  const shell = useShell();
  const me = useStore(shell.mapBridge.me);
  return point && me ? formatDistance(haversineMeters(me, point)) : null;
}
