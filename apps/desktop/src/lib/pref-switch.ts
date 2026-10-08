import { useSyncExternalStore } from 'react';
import { api } from '@moxxy/client-core';
import type { DesktopPrefs } from '@moxxy/desktop-ipc-contract';

/** The desktop preferences that are a plain on/off, on until switched off. */
type SwitchKey = { [K in keyof DesktopPrefs]: DesktopPrefs[K] extends boolean ? K : never }[keyof DesktopPrefs];

export interface PrefSwitch {
  /** Whether the switch is on (reactive). */
  readonly use: () => boolean;
  /** Switch at once and persist the choice. */
  readonly set: (next: boolean) => void;
  /** Test hook: reset the store between cases. */
  readonly resetForTests: () => void;
}

/**
 * A default-on switch persisted in the desktop prefs. One module-level store
 * per key (the `useVoiceEngine` pattern), so the control in Settings and the
 * code that obeys it read one value.
 */
export function createPrefSwitch(key: SwitchKey): PrefSwitch {
  let on = true;
  let loaded = false;
  /** Bumped on every local choice so a slower initial read cannot undo it. */
  let revision = 0;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const loadOnce = (): void => {
    if (loaded) return;
    loaded = true;
    const readAt = revision;
    void api()
      .invoke('prefs.read')
      .then((prefs) => {
        if (readAt !== revision) return;
        // Only a stored "off" turns it off: a file written before the switch existed has none.
        on = prefs[key] !== false;
        emit();
      })
      .catch(() => undefined);
  };

  const subscribe = (listener: () => void): (() => void) => {
    loadOnce();
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    use: () => useSyncExternalStore(subscribe, () => on),
    set: (next) => {
      on = next;
      loaded = true;
      revision += 1;
      emit();
      void api()
        .invoke('prefs.update', { [key]: next })
        .catch(() => undefined);
    },
    resetForTests: () => {
      on = true;
      loaded = false;
      revision = 0;
      listeners.clear();
    },
  };
}
