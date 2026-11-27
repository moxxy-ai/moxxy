import { useEffect, useState } from 'react';

/**
 * Whole seconds since `active` turned true, ticking once a second; null while
 * it is false. A run that says no percentage still shows it is moving.
 */
export function useElapsedSeconds(active: boolean): number | null {
  const [seconds, setSeconds] = useState<number | null>(active ? 0 : null);
  useEffect(() => {
    if (!active) {
      setSeconds(null);
      return undefined;
    }
    const start = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? (seconds ?? 0) : null;
}

/** 75 → "1:15". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
