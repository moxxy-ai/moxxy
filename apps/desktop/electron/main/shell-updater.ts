/**
 * Tier-2 updates: replacing the native shell (Electron/Chromium/Node or a
 * changed native-module ABI) — the rare case a JS hot-update (Tier-1) can't
 * cover. Uses electron-updater against the release the update plan names.
 *
 * There is no background check: an update is installed when the person clicks
 * Update, as one step of the plan (`app.updateAll`), never behind their back.
 * A launch-time check used to download the installer by itself, raise a system
 * notification and install on quit — a second update beside the one button.
 *
 * electron-updater is lazy-imported: a build without it keeps running and
 * Tier-1 hot-updates are unaffected.
 */

import { app } from 'electron';

/**
 * Download the FULL installer from an exact desktop release and quit into it.
 * User-triggered, on every platform. Squirrel.Mac refuses an unsigned app: on
 * such a build this rejects and the installer screen offers the release page.
 *
 * `feedBaseUrl` is the `releases/download/desktop-v<version>/` asset base of
 * the release to install, resolved by the caller (desktop-host's
 * `app.updateShell`). A GENERIC feed pinned there — never GitHub's
 * latest-release discovery, which can't parse `desktop-v*` tags and is broken
 * by the repo's npm-package releases anyway. electron-builder attaches the
 * `latest*.yml` feed files the generic provider reads to every release.
 *
 * Rejects on any failure. Resolves once the installer is downloaded and
 * verified, with the function that quits into it — the caller decides when
 * (after its own state is saved and the IPC reply can flush).
 */
export async function installFullAppUpdate(opts: {
  feedBaseUrl: string;
  onProgress: (p: {
    phase: 'download' | 'install';
    received?: number;
    total?: number;
    message?: string;
  }) => void;
}): Promise<() => void> {
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
  return () => autoUpdater.quitAndInstall();
}

/** The slice of electron-updater's autoUpdater we touch. */
interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<{ updateInfo?: { version?: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
  removeAllListeners(event: string): unknown;
}
