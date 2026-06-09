/**
 * `localStorage`-backed {@link KeyValueStore} — used only by the one-time legacy
 * chat migration. `undefined` when there's no `localStorage` (so the migration
 * becomes a no-op), which is the correct behavior off the legacy desktop origin.
 */

import type { KeyValueStore } from '@moxxy/client-core';

export const webKeyValueStore: KeyValueStore | undefined =
  typeof window !== 'undefined' && window.localStorage
    ? {
        get length(): number {
          return window.localStorage.length;
        },
        key: (index: number) => window.localStorage.key(index),
        getItem: (key: string) => window.localStorage.getItem(key),
        setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
        removeItem: (key: string) => window.localStorage.removeItem(key),
      }
    : undefined;
