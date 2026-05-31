/**
 * Tier-2 updates: replacing the native shell (Electron/Chromium/Node or a
 * changed native-module ABI) — the rare case a JS hot-update (Tier-1) can't
 * cover. Uses electron-updater against the same GitHub Releases feed the app
 * already publishes to (`package.json#build.publish`).
 *
 *   - Windows / Linux: background download + install on the next quit
 *     ("Restart to update"), surfaced by electron-updater's own notification.
 *   - macOS: a NO-OP here. Squirrel.Mac refuses to apply an update unless the
 *     app is Developer-ID-signed + notarized, which these builds are not. Until
 *     signing lands, macOS shell updates are notify-only — surfaced by the
 *     Tier-1 "needs a full app update" banner, which links to the release page.
 *
 * Everything is lazy-imported and fully guarded: if electron-updater isn't
 * present (e.g. not packaged) or the check fails (offline), the app keeps
 * running and Tier-1 hot-updates are unaffected.
 */

import { app } from 'electron';

export function initShellUpdater(): void {
  // Packaged only (no feed in dev), and not on unsigned macOS.
  if (!app.isPackaged || process.platform === 'darwin') return;

  void (async () => {
    try {
      const mod = (await import('electron-updater')) as {
        autoUpdater?: ElectronAutoUpdater;
        default?: { autoUpdater?: ElectronAutoUpdater };
      };
      const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
      if (!autoUpdater) return;

      // Download in the background; install when the user next quits. Combined
      // with electron-updater's notification this is "update arrives silently,
      // applies on restart" — no manual download/reinstall.
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.warn('[moxxy] shell updater unavailable (Tier-1 hot-updates still work):', err);
    }
  })();
}

/** The slice of electron-updater's autoUpdater we touch. */
interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdatesAndNotify(): Promise<unknown>;
}
