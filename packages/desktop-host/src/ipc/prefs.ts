/**
 * Desktop preferences (first-run + auth state).
 *
 * These are the desktop's *own* preferences (onboarding-complete,
 * Clerk identity, …) — distinct from the runner's session preferences.
 * Both handlers delegate to the `prefs` store, lazily imported so the
 * file isn't touched until the renderer asks.
 */

import type { ThemePreference } from '@moxxy/desktop-ipc-contract';
import { handle } from './shared';

const THEME_VALUES: ReadonlyArray<ThemePreference> = ['light', 'dark', 'system'];

/** Mirror the persisted theme pref into Electron's `nativeTheme.themeSource`
 *  so window chrome AND the renderer's `prefers-color-scheme` track the
 *  user's choice (`system` = follow the OS). No-op outside Electron — the
 *  handlers also run under plain-node vitest, where the `electron` package
 *  resolves to a binary-path string with no `nativeTheme` export. */
async function syncNativeTheme(theme: ThemePreference): Promise<void> {
  if (!THEME_VALUES.includes(theme)) return;
  try {
    const electron = (await import('electron')) as Partial<typeof import('electron')>;
    if (electron.nativeTheme) electron.nativeTheme.themeSource = theme;
  } catch {
    /* non-electron host (tests) */
  }
}

export function registerPrefsHandlers(): void {
  // Desktop preferences -----------------------------------------------------
  handle('prefs.read', async () => {
    const { readPrefs } = await import('../prefs');
    return readPrefs();
  });
  handle('prefs.update', async (patch) => {
    const { updatePrefs } = await import('../prefs');
    const next = await updatePrefs(patch);
    if (patch && typeof patch === 'object' && 'theme' in patch) {
      await syncNativeTheme(next.theme);
    }
    return next;
  });
}
