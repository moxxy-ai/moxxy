/**
 * Immutable bootstrap entry — the "floor".
 *
 * The packaged app's `package.json#main` points here, so this is the ONE piece
 * of the desktop that a hot-update can never replace. Its sole job: choose which
 * app bundle to run, then load that bundle's real main.
 *
 * "App bundle" = renderer + main + preload + IPC contract, shipped and activated
 * TOGETHER. The bootstrap prefers a verified, user-updated bundle under
 * `<userData>/app/<version>/` over the one baked into this `.app`, falling back
 * to the baked floor whenever anything is missing, unverified, incompatible, or
 * crashes on load. Because both sides of every IPC/protocol come from the same
 * bundle, protocol changes ride a hot-update with no version skew.
 *
 * The real main resolves its preload + renderer paths relative to its own
 * `import.meta.dirname`, so loading the userData copy automatically picks up that
 * copy's preload + `dist/` — no per-path rewiring needed here.
 *
 * The verify-before-load GATE (Ed25519 signature, compatibility) lives in
 * `@moxxy/desktop-host/app-update` and is BAKED into this file by electron-vite,
 * so the thing deciding what to run is part of the floor an attacker can't
 * replace — never the hot-updatable `index.js`.
 */
import { app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolveActiveBundle,
  recoverFromFailedBoot,
  writeBreadcrumb,
  markBad,
  setupNativeResolution,
} from '@moxxy/desktop-host/app-update';

import { BUNDLED_UPDATE_PUBLIC_KEY } from './update-key.js';

/** Dir holding this bootstrap + the baked floor `index.js` (…/dist-electron/main). */
const floorMainDir = import.meta.dirname;
/** The floor bundle root: the dir that contains `dist-electron/` + `dist/`. */
const floorRoot = path.join(floorMainDir, '..', '..');
const floorEntry = path.join(floorMainDir, 'index.js');

/** Load a real main entry for its side effects (it drives the whole app). */
async function load(entry: string): Promise<void> {
  await import(pathToFileURL(entry).href);
}

async function boot(): Promise<void> {
  // Let a userData bundle resolve the shell's optional native deps (keychain).
  setupNativeResolution(floorRoot);

  let entry = floorEntry;
  let overrideVersion: string | null = null;

  // Self-update is packaged-only; in dev the renderer is served from Vite and
  // there is no userData bundle to prefer.
  if (app.isPackaged) {
    try {
      const userData = app.getPath('userData');
      // Poison a bundle that loaded last launch but never confirmed healthy
      // (white-screen / async crash), rolling `active` back to the last good one.
      const recovery = recoverFromFailedBoot(userData);
      if (recovery.poisoned) {
        console.warn(
          `[moxxy] bootstrap: bundle ${recovery.poisoned} never confirmed healthy; poisoned` +
            (recovery.rolledBackTo ? `, rolled back to ${recovery.rolledBackTo}` : ', using floor'),
        );
      }
      const picked = resolveActiveBundle({
        userDataDir: userData,
        publicKeyPem: BUNDLED_UPDATE_PUBLIC_KEY,
        shell: { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' },
      });
      if (picked) {
        entry = path.join(picked.root, 'dist-electron', 'main', 'index.js');
        overrideVersion = picked.version;
        // Tell the running main which bundle it is — drives `app.updateInfo` and
        // the boot-probe (the real main confirms a healthy boot for this version).
        process.env.MOXXY_APP_BUNDLE_ROOT = picked.root;
        process.env.MOXXY_APP_BUNDLE_VERSION = picked.version;
        // Breadcrumb BEFORE load: if this version then crashes before it can
        // confirm itself healthy, the next launch sees an unconfirmed attempt
        // and poisons it.
        writeBreadcrumb(userData, picked.version);
      }
    } catch {
      // Any resolution failure → run the floor.
      entry = floorEntry;
      overrideVersion = null;
    }
  }

  try {
    await load(entry);
  } catch (err) {
    if (overrideVersion) {
      // The override's main threw while loading — poison it so it's never picked
      // again, then recover on the floor in the same launch.
      try {
        markBad(app.getPath('userData'), overrideVersion);
      } catch {
        /* best effort */
      }
      delete process.env.MOXXY_APP_BUNDLE_ROOT;
      delete process.env.MOXXY_APP_BUNDLE_VERSION;
      console.error(
        `[moxxy] bootstrap: app bundle ${overrideVersion} failed to load; reverting to floor:`,
        err,
      );
      await load(floorEntry);
    } else {
      throw err;
    }
  }
}

void boot().catch((err) => {
  // The floor itself failing to load is unrecoverable — surface it loudly rather
  // than dying with a silent unhandled rejection.
  console.error('[moxxy] bootstrap: failed to load app main:', err);
  app.quit();
});
