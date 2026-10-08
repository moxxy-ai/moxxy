/**
 * Whether a chat that is not on screen rings when it answers, persisted in
 * the desktop prefs. One module-level store (the `useVoiceEngine` pattern), so
 * the switch in Settings and the hook that rings read one value.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@moxxy/client-core';

const DEFAULT_ON = true;

let on = DEFAULT_ON;
let loaded = false;
/** Bumped on every local choice so a slower initial read cannot undo it. */
let revision = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  const readAt = revision;
  void api()
    .invoke('prefs.read')
    .then((prefs) => {
      if (readAt !== revision) return;
      // Only a stored "off" turns it off: a file written before the switch existed has none.
      on = prefs.replySound !== false;
      emit();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  loadOnce();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the reply sound is on (reactive). */
export function useReplySoundPreference(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}

/** Switch the reply sound at once and persist the choice. */
export function setReplySoundPreference(next: boolean): void {
  on = next;
  loaded = true;
  revision += 1;
  emit();
  void api()
    .invoke('prefs.update', { replySound: next })
    .catch(() => undefined);
}

/** Test hook: reset the module store between cases. */
export function __resetReplySoundForTests(): void {
  on = DEFAULT_ON;
  loaded = false;
  revision = 0;
  listeners.clear();
}
