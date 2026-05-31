/**
 * Self-update IPC: report the running dashboard, check the published manifest,
 * and download+install a newer dashboard bundle into the writable userData copy
 * (the bootstrap activates it on the next launch). Mirrors the "Update CLI" flow
 * in `./app.ts` — a hot-update with no installer.
 *
 * The update SOURCE is fixed here, main-side: the renderer triggers check/apply
 * but never supplies a URL (see the `z.undefined()` schemas), so a compromised
 * renderer can't redirect the loader at an attacker. The signing PUBLIC KEY is
 * baked into the app and threaded in via {@link UpdateConfig}; an empty key (or
 * a dev/unpackaged run) means self-update is reported as unavailable.
 */

import { app, BrowserWindow } from 'electron';

import {
  type ShellInfo,
  checkForUpdate,
  downloadAndStage,
  markConfirmed,
  pruneBundles,
  readActiveVersion,
} from '../app-update/index.js';
import { sendEvent } from '../send-event';
import { handle } from './shared';

export interface UpdateConfig {
  /** Baked Ed25519 public key (SPKI PEM). Empty ⇒ self-update disabled. */
  publicKeyPem: string;
  /** Manifest URL override (dev/test only). Defaults to the GitHub latest release. */
  manifestUrl?: string;
}

const DEFAULT_MANIFEST_URL =
  'https://github.com/moxxy-ai/moxxy/releases/latest/download/moxxy-app-manifest.json';

function runningVersion(): string {
  return process.env.MOXXY_APP_BUNDLE_VERSION ?? app.getVersion();
}

function shellInfo(): ShellInfo {
  return { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function registerUpdateHandlers(config: UpdateConfig): void {
  const { publicKeyPem } = config;
  // The manifest URL only ever differs from the default in dev/test (never in a
  // packaged build) so a shipped app can't be pointed at an attacker origin.
  const manifestUrl = app.isPackaged ? DEFAULT_MANIFEST_URL : config.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const enabled = (): boolean => !!publicKeyPem && app.isPackaged;

  handle('app.updateInfo', async () => ({
    version: runningVersion(),
    source: process.env.MOXXY_APP_BUNDLE_VERSION ? ('updated' as const) : ('bundled' as const),
    channelConfigured: enabled(),
  }));

  handle('app.checkUpdate', async () => {
    const currentVersion = runningVersion();
    if (!enabled()) {
      return {
        available: false,
        currentVersion,
        latestVersion: null,
        compatible: false,
        error: app.isPackaged
          ? 'Automatic updates are not configured for this build.'
          : 'Updates run only in the packaged app.',
      };
    }
    const res = await checkForUpdate({
      manifestUrl,
      currentVersion,
      publicKeyPem,
      shell: shellInfo(),
    });
    return {
      available: res.available,
      currentVersion,
      latestVersion: res.latestVersion,
      compatible: res.compatible,
      ...(res.notes ? { notes: res.notes } : {}),
      ...(res.releaseUrl ? { releaseUrl: res.releaseUrl } : {}),
    };
  });

  handle('app.updateDashboard', async () => {
    const currentVersion = runningVersion();
    if (!enabled()) {
      return { ok: false, version: null, error: 'Automatic updates are not available.' };
    }
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

    const res = await checkForUpdate({
      manifestUrl,
      currentVersion,
      publicKeyPem,
      shell: shellInfo(),
    });
    if (!res.available || !res.manifest) {
      return { ok: false, version: null, error: 'No update available.' };
    }
    if (!res.compatible) {
      return {
        ok: false,
        version: res.latestVersion,
        error: 'This update needs a newer app version — a full reinstall is required.',
      };
    }

    try {
      const { version } = await downloadAndStage({
        userDataDir: app.getPath('userData'),
        manifest: res.manifest,
        publicKeyPem,
        onProgress: (p) => {
          if (target) sendEvent(target, 'app.update.progress', p);
        },
      });
      // Keep {active, previous} so a failed boot can roll back to the last-good.
      pruneBundles(app.getPath('userData'), [version, currentVersion]);
      return { ok: true, version };
    } catch (e) {
      return { ok: false, version: null, error: messageOf(e) };
    }
  });

  handle('app.relaunch', async () => {
    // Register a relaunch, then quit gracefully (before-quit reaps the runners).
    app.relaunch();
    app.quit();
  });

  handle('app.appBooted', async () => {
    // The running override (if any) reached a healthy render — confirm it so the
    // boot-probe doesn't poison it. No-op on the bundled floor.
    const version = process.env.MOXXY_APP_BUNDLE_VERSION;
    if (version && readActiveVersion(app.getPath('userData')) === version) {
      markConfirmed(app.getPath('userData'), version);
    }
  });
}
