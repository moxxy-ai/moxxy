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

/**
 * On-demand Tier-2: download the FULL installer from an exact desktop release
 * and quit into it. Unlike {@link initShellUpdater}'s background check, this is
 * user-triggered (the "requires full update" banner) and runs on EVERY
 * platform — macOS included, now that CI signs + notarizes (Squirrel.Mac
 * refuses unsigned apps; on an unsigned build this rejects and the UI falls
 * back to the release page).
 *
 * `feedBaseUrl` is the `releases/download/desktop-v<version>/` asset base of
 * the release to install, resolved by the caller (desktop-host's
 * `app.updateShell`). A GENERIC feed pinned there — never GitHub's
 * latest-release discovery, which can't parse `desktop-v*` tags and is broken
 * by the repo's npm-package releases anyway. electron-builder attaches the
 * `latest*.yml` feed files the generic provider reads to every release.
 *
 * Rejects on any failure; only a fully downloaded + verified installer
 * reaches `quitAndInstall` (deferred a tick so the IPC reply can flush).
 */
export async function installFullAppUpdate(opts: {
  feedBaseUrl: string;
  onProgress: (p: {
    phase: 'download' | 'install';
    received?: number;
    total?: number;
    message?: string;
  }) => void;
}): Promise<void> {
  if (!app.isPackaged) throw new Error('Full app updates run only in the packaged app.');
  const mod = (await import('electron-updater')) as {
    autoUpdater?: ElectronAutoUpdater;
    default?: { autoUpdater?: ElectronAutoUpdater };
  };
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!autoUpdater) throw new Error('electron-updater is not available in this build.');

  // Explicit, user-triggered flow: no background download, no install-on-quit
  // side effects from the launch check.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: opts.feedBaseUrl });

  // The module-level autoUpdater is a singleton — drop listeners from any
  // previous attempt before wiring this one.
  autoUpdater.removeAllListeners('download-progress');
  autoUpdater.on('download-progress', (p: { transferred?: number; total?: number }) => {
    opts.onProgress({ phase: 'download', received: p.transferred, total: p.total });
  });

  opts.onProgress({ phase: 'download', message: 'Fetching installer…' });
  const check = await autoUpdater.checkForUpdates();
  const updateInfo = check?.updateInfo;
  if (!updateInfo?.version) {
    throw new Error('No installer found for this release.');
  }
  await autoUpdater.downloadUpdate();
  opts.onProgress({ phase: 'install', message: 'Restarting to install…' });
  // Defer past the IPC reply; before-quit teardown (runner reap) still runs.
  setImmediate(() => autoUpdater.quitAndInstall());
}

/** The slice of electron-updater's autoUpdater we touch. */
interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdatesAndNotify(): Promise<unknown>;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeAllListeners(event: string): unknown;
}
