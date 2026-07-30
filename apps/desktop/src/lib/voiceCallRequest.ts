import { useEffect, useRef } from 'react';
import { useSyncExternalStore } from 'react';

/**
 * "Open the voice call" as a pulse the shell can fire from outside the chat.
 *
 * The call itself lives inside {@link ChatSurface} (it owns the session the call
 * runs against), so the only way in used to be a speaker icon in the composer's
 * action row — where it sat beside the mic and read as a text-to-speech toggle
 * rather than as a whole mode. The rail needs to reach it without the call state
 * moving up to the shell, so this is a counter the rail bumps and the surface
 * watches. Same shape as `useRailWidth`: a module store, renderer-only.
 */

let pulse = 0;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestVoiceCall(): void {
  pulse += 1;
  for (const fn of listeners) fn();
}

/** Run `onRequested` once per {@link requestVoiceCall}. The callback is held in a
 *  ref so an inline arrow doesn't re-arm the effect on every render. */
export function useVoiceCallRequest(onRequested: () => void): void {
  const current = useSyncExternalStore(
    subscribe,
    () => pulse,
    () => pulse,
  );
  const cb = useRef(onRequested);
  cb.current = onRequested;
  const seen = useRef(current);
  useEffect(() => {
    if (seen.current === current) return;
    seen.current = current;
    cb.current();
  }, [current]);
}
