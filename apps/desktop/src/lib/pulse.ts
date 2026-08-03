import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * A one-shot "do this now" signal from the shell to whichever component owns
 * the capability.
 *
 * The shell holds the keymap, but several actions live deep inside the chat
 * surface (the palette, transcript search, aborting the running turn) and their
 * state has no business moving up to `App`. A pulse is a counter the shell bumps
 * and the owner watches. Same shape as `voiceCallRequest` already uses for the
 * rail's voice button, generalized so each new shortcut isn't another bespoke
 * module.
 */
export interface Pulse {
  /** Fire the signal. */
  readonly request: () => void;
  /** Run `onRequested` once per `request()`. */
  readonly use: (onRequested: () => void) => void;
}

export function createPulse(): Pulse {
  let count = 0;
  const listeners = new Set<() => void>();

  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  return {
    request(): void {
      count += 1;
      for (const fn of listeners) fn();
    },
    use(onRequested: () => void): void {
      const current = useSyncExternalStore(subscribe, () => count, () => count);
      const cb = useRef(onRequested);
      cb.current = onRequested;
      // Seed from the value at mount so a component mounting after a pulse
      // doesn't immediately replay it.
      const seen = useRef(current);
      useEffect(() => {
        if (seen.current === current) return;
        seen.current = current;
        cb.current();
      }, [current]);
    },
  };
}
