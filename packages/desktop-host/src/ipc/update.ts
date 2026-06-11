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
  readConfirmed,
  readBadVersions,
  listStagedVersions,
  appendBootLog,
  readBootLog,
} from '../app-update/index.js';
import { sendEvent } from '../send-event';
import { wsEventBus } from '../event-bus';
import { handle } from './shared';

export interface UpdateConfig {
  /** Baked Ed25519 public key (SPKI PEM). Empty ⇒ self-update disabled. */
  publicKeyPem: string;
  /** Manifest URL override (dev/test only). Defaults to the GitHub latest release. */
  manifestUrl?: string;
  /**
   * Runner protocol version the floor's pinned CLI speaks — the same ceiling
   * the bootstrap's boot gate enforces (`FLOOR_RUNNER_PROTOCOL`, see
   * `apps/desktop/electron/main/bootstrap.ts`). Threading it here lets the
   * check/stage flow refuse a bundle the boot gate would silently reject
   * (`runner-protocol-skew`) and tell the user a full app update is needed,
   * instead of claiming "updated — relaunch" that never takes effect. Omit to
   * skip the gate.
   */
  cliRunnerProtocol?: number;
}

/** The GitHub repo whose `desktop-v*` releases the updater pulls from. */
const GH_REPO = 'moxxy-ai/moxxy';

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
  const { publicKeyPem, cliRunnerProtocol } = config;
  // A manifest-URL override is honored ONLY in dev/test (never in a packaged
  // build) so a shipped app can't be pointed at an attacker origin; in prod the
  // updater discovers the latest desktop release from GH_REPO's API.
  const manifestUrlOverride = app.isPackaged ? undefined : config.manifestUrl;
  const enabled = (): boolean => !!publicKeyPem && app.isPackaged;
  const check = (currentVersion: string): ReturnType<typeof checkForUpdate> =>
    checkForUpdate({
      repo: GH_REPO,
      currentVersion,
      publicKeyPem,
      shell: shellInfo(),
      cliRunnerProtocol,
      manifestUrlOverride,
    });

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
    const res = await check(currentVersion);
    return {
      available: res.available,
      currentVersion,
      latestVersion: res.latestVersion,
      compatible: res.compatible,
      ...(res.requiresFullUpdate ? { requiresFullUpdate: true } : {}),
      ...(res.notes ? { notes: res.notes } : {}),
      ...(res.releaseUrl ? { releaseUrl: res.releaseUrl } : {}),
      ...(res.error ? { error: res.error } : {}),
    };
  });

  handle('app.updateDashboard', async () => {
    const currentVersion = runningVersion();
    if (!enabled()) {
      return { ok: false, version: null, error: 'Automatic updates are not available.' };
    }
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

    const res = await check(currentVersion);
    if (!res.available || !res.manifest) {
      return { ok: false, version: null, error: res.error ?? 'No update available.' };
    }
    if (res.requiresFullUpdate) {
      // The bundle's runner protocol outruns the CLI this install can spawn:
      // staging it would only produce an "updated — relaunch" that the boot
      // gate rejects (`runner-protocol-skew`) on every launch. Distinct status
      // so the UI sends the user to the full installer (Tier-2) instead.
      return {
        ok: false,
        version: res.latestVersion,
        requiresFullUpdate: true,
        error: 'This update changes the bundled runner and needs the full app installer — it cannot be applied as a hot-update.',
      };
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
        // Belt-and-braces: the stager re-checks the runner-protocol gate itself.
        ...(typeof cliRunnerProtocol === 'number' ? { cliRunnerProtocol } : {}),
        ...(res.bundleUrl ? { bundleUrl: res.bundleUrl } : {}),
        onProgress: (p) => {
          if (target) sendEvent(target, 'app.update.progress', p);
          // Mirror to non-Electron transports. No-op without a WS bridge.
          wsEventBus.broadcast('app.update.progress', p);
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
    if (!version) return;
    const userData = app.getPath('userData');
    const active = readActiveVersion(userData);
    if (active === version) {
      markConfirmed(userData, version);
      appendBootLog(userData, { phase: 'confirm', picked: version, ...shellInfo() });
    } else {
      // The confirm arrived but the active pointer no longer matches the running
      // bundle (e.g. a concurrent re-stage) — the probe would revert a bundle the
      // user is actively running. Record it instead of silently dropping it.
      appendBootLog(userData, {
        phase: 'confirm',
        picked: version,
        reason: `active-pointer-mismatch (active=${active ?? 'none'})`,
        ...shellInfo(),
      });
    }
  });

  handle('app.bootHeartbeatFailed', async (args) => {
    // The renderer couldn't deliver its boot heartbeat — make that visible so a
    // confirm-path failure is diagnosable rather than masquerading as a revert.
    const version = process.env.MOXXY_APP_BUNDLE_VERSION;
    if (!version) return;
    appendBootLog(app.getPath('userData'), {
      phase: 'confirm',
      picked: version,
      reason: 'heartbeat-delivery-failed',
      error: args.error,
      ...shellInfo(),
    });
  });

  handle('app.updateDiagnostics', async () => {
    const userData = app.getPath('userData');
    return {
      running: runningVersion(),
      active: readActiveVersion(userData),
      confirmed: readConfirmed(userData),
      bad: [...readBadVersions(userData)],
      staged: listStagedVersions(userData),
      log: readBootLog(userData, 30),
    };
  });
}
