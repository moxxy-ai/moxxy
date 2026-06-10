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
  resolveActiveBundleDetailed,
  recoverFromFailedBoot,
  writeBreadcrumb,
  markBad,
  appendBootLog,
  setupNativeResolution,
} from '@moxxy/desktop-host/app-update';

import { BUNDLED_UPDATE_PUBLIC_KEY } from './update-key.js';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol.js';

// MUST run before any `app.getPath('userData')` below. `userData` resolves to
// `…/Application Support/<app.getName()>`, and in a packaged build Electron
// derives `getName()` from the app package.json `name` (`@moxxy/desktop`), NOT
// electron-builder's `productName`. The real main (`index.js`) calls
// `app.setName('MoxxyAI Workspaces')` too — but it loads LATER, so without
// setting the name HERE the bootstrap would read the self-update state
// (active.json / staged bundles) from a DIFFERENT userData dir than the one the
// updater writes to. That mismatch made every staged update invisible to the
// loader, so the app silently kept booting the floor. Keep this string in sync
// with `index.ts`.
app.setName('MoxxyAI Workspaces');

/** Dir holding this bootstrap + the baked floor `index.js` (…/dist-electron/main). */
const floorMainDir = import.meta.dirname;
/** The floor bundle root: the dir that contains `dist-electron/` + `dist/`. */
const floorRoot = path.join(floorMainDir, '..', '..');
const floorEntry = path.join(floorMainDir, 'index.js');

/** Load a real main entry for its side effects (it drives the whole app). */
async function load(entry: string): Promise<void> {
  await import(pathToFileURL(entry).href);
}

/** Shell identity stamped onto every boot-log entry, for cross-launch context. */
const shell = { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' };

async function boot(): Promise<void> {
  // Let a userData bundle resolve the shell's optional native deps (keychain).
  setupNativeResolution(floorRoot);

  let entry = floorEntry;
  let overrideVersion: string | null = null;
  let userData: string | null = null;

  // Self-update is packaged-only; in dev the renderer is served from Vite and
  // there is no userData bundle to prefer.
  if (app.isPackaged) {
    try {
      userData = app.getPath('userData');
      // Poison a bundle that loaded last launch but never confirmed healthy
      // (white-screen / async crash), rolling `active` back to the last good one.
      const recovery = recoverFromFailedBoot(userData);
      if (recovery.poisoned) {
        console.warn(
          `[moxxy] bootstrap: bundle ${recovery.poisoned} never confirmed healthy; poisoned` +
            (recovery.rolledBackTo ? `, rolled back to ${recovery.rolledBackTo}` : ', using floor'),
        );
        appendBootLog(userData, {
          phase: 'recover',
          picked: recovery.poisoned,
          reason: 'unconfirmed-previous-boot',
          ...(recovery.rolledBackTo ? { recoveredTo: recovery.rolledBackTo } : {}),
          ...shell,
        });
      }
      // Detailed resolve so a fall-to-floor records WHY (the reject reason) —
      // turning a previously-silent revert into a copy-pasteable diagnostic.
      const resolved = resolveActiveBundleDetailed({
        userDataDir: userData,
        publicKeyPem: BUNDLED_UPDATE_PUBLIC_KEY,
        shell,
        // Lockstep gate: refuse a JS bundle whose bundled client outruns the
        // pinned CLI's runner (the hot-update protocol-skew loop). The floor's
        // CLI is what we spawn, so its protocol is the ceiling for a hot-update.
        cliRunnerProtocol: FLOOR_RUNNER_PROTOCOL,
      });
      if (resolved.bundle) {
        const picked = resolved.bundle;
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
        appendBootLog(userData, { phase: 'boot', picked: picked.version, ...shell });
      } else {
        // `disabled`/`no-active` are the normal "nothing staged" cases; anything
        // else is a staged bundle we declined — exactly what we want visible.
        appendBootLog(userData, { phase: 'boot', picked: 'floor', reason: resolved.reason, ...shell });
      }
    } catch (err) {
      // Any resolution failure → run the floor.
      entry = floorEntry;
      overrideVersion = null;
      if (userData) {
        appendBootLog(userData, { phase: 'boot', picked: 'floor', reason: 'resolve-threw', error: messageOf(err), ...shell });
      }
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
      // Record the ACTUAL import error (previously console-only, so invisible in
      // a packaged build) — this is the prime suspect for "updates but reverts".
      if (userData) {
        appendBootLog(userData, { phase: 'load-error', picked: overrideVersion, error: messageOf(err), ...shell });
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

function messageOf(e: unknown): string {
  return e instanceof Error ? `${e.message}` : String(e);
}

void boot().catch((err) => {
  // The floor itself failing to load is unrecoverable — surface it loudly rather
  // than dying with a silent unhandled rejection.
  console.error('[moxxy] bootstrap: failed to load app main:', err);
  app.quit();
});
