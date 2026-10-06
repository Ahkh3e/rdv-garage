import { useCallback, useRef, useState } from "react";
import { messageFor } from "./errors";

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
