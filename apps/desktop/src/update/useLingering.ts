import { useCallback, useRef, useState } from 'react';

export interface Lingering<T> {
  /** The value to draw: the current one, or the last one while it leaves. */
  readonly shown: T | null;
  /** The value is gone and its exit is playing. */
  readonly leaving: boolean;
  /** Call when the exit has played. */
  readonly onExited: () => void;
}

/**
 * Keeps the last value on screen after it turns null, so what showed it can
 * play its exit; the exit's own end (`onExited`) is what removes it.
 */
export function useLingering<T>(value: T | null): Lingering<T> {
  const last = useRef<T | null>(value);
  const [exited, setExited] = useState(value === null);
  if (value !== null) {
    last.current = value;
    if (exited) setExited(false);
  }
  const present = useRef(false);
  present.current = value !== null;
  const onExited = useCallback(() => {
    if (!present.current) setExited(true);
  }, []);
  const leaving = value === null && !exited;
  return { shown: value ?? (leaving ? last.current : null), leaving, onExited };
}
