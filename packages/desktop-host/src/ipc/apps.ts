/**
 * Apps-gallery install lifecycle IPC.
 *
 * Some apps need a one-time local asset download before first use (the document
 * anonymizer's on-device NER model). These handlers drive that: status, install
 * (streaming `apps.install.progress` so the gallery shows a bar), and uninstall.
 * The actual download + verify + containment lives in {@link ../apps/installer}
 * (electron-free, unit-tested); this module is the thin IPC + Electron glue.
 *
 * The fetch in `apps.install` is the ONLY network the anonymizer ever touches,
 * it runs here in the MAIN process, and it's gated behind an explicit Install
 * click. Assets land under `userData/moxxy-apps/<appId>/` and are served back to
 * the renderer over the confined `moxxy-app://` scheme — no use-time egress.
 */

import { app, BrowserWindow } from 'electron';

import type { AppInstallProgress, AppInstallStatus } from '@moxxy/desktop-ipc-contract';
import { sendEvent } from '../send-event';
import { wsEventBus } from '../event-bus';
import { appStatus, installApp, uninstallApp } from '../apps/installer.js';
import { APP_INSTALLERS } from '../apps/registry.js';
import { handle, IpcError } from './shared';

/** Root for every app's installed assets: `userData/moxxy-apps`. */
function appsRoot(): string {
  return `${app.getPath('userData')}/moxxy-apps`;
}

/**
 * Push an `apps.install.progress` event both to the focused renderer window
 * (Electron path) AND to any WS-bridge sinks — mirrors the dual-emit
 * `update.ts` uses for `app.update.progress`. No-op without a window / bridge.
 */
function broadcastProgress(p: AppInstallProgress): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (target) sendEvent(target, 'apps.install.progress', p);
  wsEventBus.broadcast('apps.install.progress', p);
}

/** Ids whose install is in flight — a re-entrant `apps.install` for the same
 *  app no-ops (returns current status) instead of racing two downloaders. */
const installing = new Set<string>();

export function registerAppsHandlers(): void {
  handle('apps.status', async ({ appId }) => {
    const spec = APP_INSTALLERS[appId];
    // Unknown ids have no installable assets — report not-installed gracefully
    // rather than throwing (status is only meaningfully called for installable
    // apps, but a stale renderer id must not error).
    if (!spec) return { appId, state: 'not-installed' };
    return appStatus(spec, appsRoot());
  });

  handle('apps.install', async ({ appId }) => {
    const spec = APP_INSTALLERS[appId];
    if (!spec) throw new IpcError('not-supported', `no installer for app: ${appId}`);
    const root = appsRoot();
    // Concurrency guard: a second click while a download runs returns the live
    // status (already 'installing' from the renderer's view) instead of
    // spawning a competing installer.
    if (installing.has(appId)) {
      const current = await appStatus(spec, root);
      return current.state === 'installed'
        ? current
        : ({ appId, state: 'installing' } satisfies AppInstallStatus);
    }
    installing.add(appId);
    try {
      return await installApp(spec, root, broadcastProgress);
    } finally {
      installing.delete(appId);
    }
  });

  handle('apps.uninstall', async ({ appId }) => uninstallApp(appId, appsRoot()));
}
