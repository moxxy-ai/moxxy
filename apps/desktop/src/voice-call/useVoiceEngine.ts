/**
 * Voice Mode engine preference (`local` | `gpt-live`), persisted in the
 * desktop prefs. One module-level store (the `useTheme` pattern) so Settings
 * and every Voice Mode surface in this window switch together without a
 * prefs re-fetch.
 */
import { useSyncExternalStore } from 'react';
import { api } from '@moxxy/client-core';
import type { VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';

const DEFAULT_ENGINE: VoiceEnginePreference = 'local';

let engine: VoiceEnginePreference = DEFAULT_ENGINE;
let loaded = false;
/** Bumped on every local choice so a slower initial read cannot undo it. */
let revision = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function normalize(value: unknown): VoiceEnginePreference {
  return value === 'gpt-live' ? 'gpt-live' : DEFAULT_ENGINE;
}

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  const readAt = revision;
  void api()
    .invoke('prefs.read')
    .then((prefs) => {
      if (readAt !== revision) return;
      engine = normalize(prefs.voiceEngine);
      emit();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  loadOnce();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The selected Voice Mode engine (reactive). */
export function useVoiceEnginePreference(): VoiceEnginePreference {
  return useSyncExternalStore(subscribe, () => engine);
}

/** Switch engines instantly and persist the choice. */
export function setVoiceEnginePreference(next: VoiceEnginePreference): void {
  engine = next;
  loaded = true;
  revision += 1;
  emit();
  void api()
    .invoke('prefs.update', { voiceEngine: next })
    .catch(() => undefined);
}

/** Test hook: reset the module store between cases. */
export function __resetVoiceEngineForTests(): void {
  engine = DEFAULT_ENGINE;
  loaded = false;
  revision = 0;
  listeners.clear();
}
