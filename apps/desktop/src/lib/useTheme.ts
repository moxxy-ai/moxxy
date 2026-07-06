/**
 * Theme controller — maps the persisted `theme` desktop pref
 * (`light` | `dark` | `system`) onto `data-theme="dark"` on `<html>`, which
 * is what `styles.css`'s dark token block keys off. `system` follows the OS
 * via `prefers-color-scheme` (live: we subscribe to the media query, and the
 * main process mirrors the pref into `nativeTheme.themeSource`, so an
 * explicit light/dark choice ALSO flips what the media query reports).
 *
 * One tiny module-level store (not a per-hook useState) so the single
 * `useTheme()` mount in App and the Appearance settings tab share state —
 * picking a theme in settings applies instantly without a prefs re-fetch.
 *
 * Focus mode mounts this controller too. It keeps its own standalone CSS
 * variables, but uses the same `<html data-theme>` switch as the main app.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@moxxy/client-core';
import type { ThemePreference } from '@moxxy/desktop-ipc-contract';

let pref: ThemePreference = 'system';
let fetched = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function systemQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

/** Effective darkness for a preference: explicit wins, `system` asks the OS. */
export function isEffectiveDark(p: ThemePreference = pref): boolean {
  return p === 'system' ? !!systemQuery()?.matches : p === 'dark';
}

/** Set / clear `data-theme="dark"` on the document element. */
function applyDom(): void {
  if (typeof document === 'undefined') return;
  if (isEffectiveDark()) {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

/** The current theme preference (reactive). */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pref,
  );
}

/** Apply + persist a new preference. DOM flips synchronously (snappy UI);
 *  the prefs write — and main's nativeTheme mirror — follow asynchronously. */
export function setThemePreference(next: ThemePreference): void {
  pref = next;
  fetched = true;
  emit();
  applyDom();
  void api()
    .invoke('prefs.update', { theme: next })
    .catch(() => undefined);
}

/**
 * Mount-once controller (App.tsx): loads the persisted preference, applies
 * it to `<html data-theme>`, and re-applies on OS scheme changes while the
 * preference is `system`.
 */
export function useTheme(): void {
  useEffect(() => {
    if (!fetched) {
      fetched = true;
      void api()
        .invoke('prefs.read')
        .then((p) => {
          pref = p.theme ?? 'system';
          emit();
          applyDom();
        })
        .catch(() => undefined);
    } else {
      applyDom();
    }

    const mq = systemQuery();
    const onChange = (): void => {
      if (pref === 'system') applyDom();
    };
    if (mq) mq.addEventListener?.('change', onChange);
    return () => {
      if (mq) mq.removeEventListener?.('change', onChange);
    };
  }, []);
}

/** Test hook: reset the module store between cases. */
export function __resetThemeForTests(): void {
  pref = 'system';
  fetched = false;
  listeners.clear();
  if (typeof document !== 'undefined') delete document.documentElement.dataset.theme;
}
