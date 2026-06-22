import { useEffect, useRef, useState } from 'react';

/**
 * Throttle a rapidly-changing value to at most one update per `intervalMs`
 * (leading edge + trailing flush), so a high-frequency producer — e.g. a live
 * token stream emitting a new string per chunk — drives a bounded render rate
 * instead of one render per change.
 *
 * `flushImmediately(value)` bypasses the throttle for values that must land at
 * once. The streaming transcript uses it for the empty string a stream emits
 * when it settles, so the live row drops in lockstep with the committed final
 * message rather than lagging a frame behind it (which would briefly show both).
 */
export function useThrottledValue<T>(
  value: T,
  intervalMs: number,
  flushImmediately?: (value: T) => boolean,
): T {
  const [shown, setShown] = useState(value);
  const latestRef = useRef(value);
  const lastEmitRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = value;

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (flushImmediately?.(value)) {
      clearTimer();
      lastEmitRef.current = Date.now();
      setShown(value);
      return;
    }

    const elapsed = Date.now() - lastEmitRef.current;
    if (elapsed >= intervalMs) {
      lastEmitRef.current = Date.now();
      setShown(value);
    } else if (timerRef.current == null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastEmitRef.current = Date.now();
        setShown(latestRef.current);
      }, intervalMs - elapsed);
    }
    // Effect intentionally keys only on `value`/`intervalMs`; `flushImmediately`
    // is a stable predicate (callers pass a literal) and is read, not depended on.
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return shown;
}
