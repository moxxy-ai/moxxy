/**
 * Tier-2 updates: replacing the native shell (Electron/Chromium/Node or a
 * changed native-module ABI) — the rare case a JS hot-update (Tier-1) can't
 * cover. On Windows and Linux electron-updater installs the release the update
 * plan names. On macOS Moxxy replaces itself (`@moxxy/desktop-host`'s
 * `shell-update`): electron-updater hands the archive to Squirrel.Mac, which
 * reads all of it into memory and crashed the app once the installer grew past
 * a gigabyte.
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
import { appBundleOf, applyShellUpdate, prepareMacAppUpdate } from '@moxxy/desktop-host';

type Progress = (p: { phase: 'download' | 'install'; received?: number; total?: number; message?: string }) => void;

/** Set once a new macOS app is downloaded, checked and waiting to be moved in. */
let macUpdateWaitingIn: string | null = null;

/**
 * macOS: download the release's archive to disk, unpack and check it against
 * this app's signature, and leave it waiting. The returned function restarts
 * Moxxy; the new app takes the old one's place as the process exits
 * ({@link finishFullAppUpdate}), and the relaunch then starts it.
 */
async function installMacAppUpdate(opts: { feedBaseUrl: string; onProgress: Progress }): Promise<() => void> {
  const appPath = appBundleOf(app.getPath('exe'));
  if (!appPath) throw new Error('Moxxy is not running from an app it could replace.');
  const userDataDir = app.getPath('userData');
  opts.onProgress({ phase: 'download', message: 'Fetching the new version…' });
  await prepareMacAppUpdate({ feedBaseUrl: opts.feedBaseUrl, appPath, userDataDir, arch: process.arch, onProgress: opts.onProgress });
  opts.onProgress({ phase: 'install', message: 'Restarting to install…' });
  return () => {
    macUpdateWaitingIn = userDataDir;
    app.relaunch();
    app.quit();
  };
}

/**
 * The last thing before the process exits: move a waiting macOS app in. A move
 * that fails leaves the installed app where it was and its reason on disk for
 * the launch after. Does nothing when no update is waiting.
 */
export function finishFullAppUpdate(): void {
  if (!macUpdateWaitingIn) return;
  const moved = applyShellUpdate(macUpdateWaitingIn);
  macUpdateWaitingIn = null;
  if (!moved.ok) console.error(`[moxxy] full app update: ${moved.error}`);
}

/**
 * Download the FULL installer from an exact desktop release and quit into it.
 * User-triggered, on every platform. A macOS app that is unsigned, or cannot
 * change the folder it is in, cannot replace itself: this rejects and the
 * installer screen offers the release page.
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
export async function installFullAppUpdate(opts: { feedBaseUrl: string; onProgress: Progress }): Promise<() => void> {
  if (!app.isPackaged) throw new Error('Full app updates run only in the packaged app.');
  if (process.platform === 'darwin') return installMacAppUpdate(opts);
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
