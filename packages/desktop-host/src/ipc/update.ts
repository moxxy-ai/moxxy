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

import { randomUUID } from 'node:crypto';
import { app, BrowserWindow } from 'electron';
import { appUpdatePlanState, type AppSetupState, type AppUpdateCheck, type AppUpdatePlan } from '@moxxy/desktop-ipc-contract';

import {
  type ShellInfo,
  checkForUpdate,
  clearActiveVersion,
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
import { settleShellUpdate } from '../shell-update/index.js';
import { buildUpdatePlan, createUpdatePlanStore, runUpdatePlan, settleUpdatePlan, type UpdatePlanStore } from '../update-plan/index.js';
import { handle } from './shared';

/** One settle per launch, shared by every transport the handlers serve. */
let planSettled: Promise<void> | null = null;

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
  /** The runner version this app was built with: where the launch after an
   *  update brings the runner and extensions. Omit to leave them as installed. */
  componentsVersion?: string;
  /** What this launch is setting up before its first runner (`startup-setup`). */
  setup?: () => AppSetupState;
  /**
   * Tier-2: download + install the FULL app installer from the given release
   * download base (`https://github.com/<repo>/releases/download/desktop-v<v>/`)
   * and return the function that quits into it. Injected by the app main
   * (which owns the electron-updater dependency — this package stays free of
   * it); omitted ⇒ `app.updateShell` reports unavailable and the UI falls back
   * to the release page. Must REJECT on any failure (unsigned macOS build,
   * missing installer asset) rather than half-installing.
   */
  installShellUpdate?: (opts: {
    feedBaseUrl: string;
    onProgress: (p: { phase: 'download' | 'install'; received?: number; total?: number; message?: string }) => void;
  }) => Promise<() => void>;
  /**
   * The bundle running was loaded by an installed app whose runner is too old
   * for it (`shellIsBehind`) — what a release does to an app that predates the
   * unsigned `needsRunnerProtocol`. No agent can start; the one thing to do is
   * install the full app of this bundle's version, which starts by itself once
   * the window is up.
   */
  shellBehind?: boolean;
}

/** The GitHub repo whose `desktop-v*` releases the updater pulls from. */
const GH_REPO = 'moxxy-ai/moxxy';

function runningVersion(): string {
  return process.env.MOXXY_APP_BUNDLE_VERSION ?? app.getVersion();
}

function shellInfo(): ShellInfo {
  return { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' };
}

const releasePage = (version: string): string => `https://github.com/${GH_REPO}/releases/tag/desktop-v${version}`;

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
  const shellBehind = config.shellBehind === true;
  const check = (currentVersion: string): ReturnType<typeof checkForUpdate> =>
    checkForUpdate({
      repo: GH_REPO,
      currentVersion,
      publicKeyPem,
      shell: shellInfo(),
      cliRunnerProtocol,
      manifestUrlOverride,
      poisonedVersions: readBadVersions(app.getPath('userData')),
    });

  handle('app.updateInfo', async () => ({
    version: runningVersion(),
    source: process.env.MOXXY_APP_BUNDLE_VERSION ? ('updated' as const) : ('bundled' as const),
    channelConfigured: enabled(),
  }));

  const checkUpdate = async (): Promise<AppUpdateCheck> => {
    const currentVersion = runningVersion();
    if (shellBehind) {
      // The update on offer is the one half in: the installed app for the
      // bundle already running. Known without asking the network.
      return {
        available: true,
        currentVersion: app.getVersion(),
        latestVersion: currentVersion,
        compatible: false,
        requiresFullUpdate: true,
        releaseUrl: releasePage(currentVersion),
      };
    }
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
  };
  handle('app.checkUpdate', checkUpdate);

  const stageDashboard = async (): Promise<{ ok: boolean; version: string | null; error?: string; requiresFullUpdate?: boolean }> => {
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
      // Keep the freshly-staged version, the currently-running one, AND the
      // last confirmed-good — the exact bundle `recoverFromFailedBoot` rolls
      // back to if the new version fails its boot health-check. Pruning to just
      // {staged, running} drops the rollback target whenever they differ from
      // `confirmed` (e.g. staging while running the FLOOR, where running ==
      // floor but confirmed == an older override), so a failed boot falls all
      // the way to the floor instead of the last-good override — part of the
      // 0.10 → 0.8 downgrade.
      const confirmed = readConfirmed(app.getPath('userData'));
      pruneBundles(
        app.getPath('userData'),
        confirmed ? [version, currentVersion, confirmed] : [version, currentVersion],
      );
      return { ok: true, version };
    } catch (e) {
      return { ok: false, version: null, error: messageOf(e) };
    }
  };
  handle('app.updateDashboard', stageDashboard);

  /** Downloads the full installer; `install` quits into it. */
  const downloadShell = async (): Promise<{ ok: true; install: () => void } | { ok: false; error: string }> => {
    // Tier-2: the hot-update path can't deliver this release (runner bump /
    // shell incompatibility) — fetch the FULL installer and replace the app.
    const currentVersion = runningVersion();
    if (!enabled()) {
      return { ok: false, error: 'Full app updates run only in the packaged app.' };
    }
    const installShellUpdate = config.installShellUpdate;
    if (!installShellUpdate) {
      return { ok: false, error: 'Full app updates are not available in this build.' };
    }
    // With the installed app behind, the release to install is the one whose
    // bundle is running; otherwise the newest one.
    const res = shellBehind ? { available: true, latestVersion: currentVersion, error: undefined } : await check(currentVersion);
    if (!res.available || !res.latestVersion) {
      return { ok: false, error: res.error ?? 'No update available.' };
    }
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    try {
      const install = await installShellUpdate({
        // Pinned at the exact release the manifest named — NEVER a "latest"
        // endpoint: desktop-v* tags don't hold the repo's Latest badge, and
        // npm-package releases break latest-based discovery anyway.
        feedBaseUrl: `https://github.com/${GH_REPO}/releases/download/desktop-v${res.latestVersion}/`,
        onProgress: (p) => {
          if (target) sendEvent(target, 'app.update.progress', p);
          wsEventBus.broadcast('app.update.progress', p);
        },
      });
      return { ok: true, install };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  };
  handle('app.updateShell', async () => {
    const shell = await downloadShell();
    if (!shell.ok) return shell;
    // Deferred past the IPC reply; before-quit teardown (runner reap) still runs.
    setImmediate(shell.install);
    return { ok: true };
  });

  const relaunch = (): void => {
    // Register a relaunch, then quit gracefully (before-quit reaps the runners).
    app.relaunch();
    app.quit();
  };
  const planStore = (): UpdatePlanStore => createUpdatePlanStore(app.getPath('userData'));
  const emitPlan = (plan: AppUpdatePlan): void => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (target) sendEvent(target, 'app.update.plan', plan);
    wsEventBus.broadcast('app.update.plan', plan);
  };
  // Once per launch, before anything else touches the plan: settling a plan
  // this launch is carrying out would fail its running step.
  const settlePlan = (): Promise<void> =>
    (planSettled ??= (async () => {
      // First what the full installer left: with the new app running, the one
      // it replaced is removed; otherwise it says why the new one is not.
      const installed = await settleShellUpdate({ userDataDir: app.getPath('userData'), shellVersion: app.getVersion() });
      const store = planStore();
      const plan = await store.read();
      if (!plan) return;
      const why = installed && !installed.installed ? installed.error : undefined;
      await store.write(settleUpdatePlan(plan, { app: runningVersion(), shell: app.getVersion() }, why));
    })().catch((error: unknown) => {
      console.warn('[moxxy] update plan could not be settled:', error);
    }));

  handle('app.updatePlan', async () => {
    await settlePlan();
    return planStore().read();
  });

  type UpdateAllResult = { ok: boolean; plan: AppUpdatePlan | null; error?: string };
  const runUpdateAll = async (): Promise<UpdateAllResult> => {
    await settlePlan();
    const store = planStore();
    const plan = buildUpdatePlan({ app: await checkUpdate(), id: randomUUID(), now: Date.now(), completes: shellBehind });
    if (!plan) {
      await store.clear();
      return { ok: true, plan: null };
    }
    const must = async (step: Promise<{ ok: boolean; error?: string }>, fallback: string): Promise<void> => {
      const result = await step;
      if (!result.ok) throw new Error(result.error ?? fallback);
    };
    let restart = relaunch;
    const result = await runUpdatePlan(plan, {
      save: store.write,
      onChange: emitPlan,
      actions: {
        app: () => must(stageDashboard(), 'The app update could not be installed.'),
        installer: async () => {
          const shell = await downloadShell();
          if (!shell.ok) throw new Error(shell.error);
          restart = shell.install;
        },
        // The plan is saved as restarting before this runs; deferred so the
        // reply to the renderer can flush.
        restart: async () => void setImmediate(() => restart()),
      },
    });
    const failed = result.steps.find((step) => step.status === 'failed');
    return failed ? { ok: false, plan: result, ...(failed.error ? { error: failed.error } : {}) } : { ok: true, plan: result };
  };
  // One update at a time: a second ask (a double click, another window) joins the first.
  let updating: Promise<UpdateAllResult> | null = null;
  const updateAll = (): Promise<UpdateAllResult> =>
    (updating ??= runUpdateAll().finally(() => {
      updating = null;
    }));
  handle('app.updateAll', updateAll);

  // With the installed app behind, the update finishes itself once per launch.
  // An attempt that already failed is shown again, not repeated unasked.
  let completion: Promise<void> | null = null;
  const completeUpdate = (): Promise<void> =>
    (completion ??= (async () => {
      await settlePlan();
      const last = await planStore().read();
      const failedBefore = last?.completes === true && last.version === runningVersion() && appUpdatePlanState(last) === 'failed';
      if (failedBefore) emitPlan(last);
      else await updateAll();
    })().catch((error: unknown) => {
      console.warn('[moxxy] the update could not be completed:', error);
    }));

  handle('app.revertUpdate', async () => {
    if (!shellBehind) return;
    // Not poisoned: the bundle is sound, the installed app is what is behind.
    clearActiveVersion(app.getPath('userData'));
    await planStore().clear();
    relaunch();
  });

  const NOTHING_TO_SET_UP: AppSetupState = { reason: null, phase: 'done', steps: [], notes: [] };
  handle('app.setup', async () => config.setup?.() ?? NOTHING_TO_SET_UP);

  handle('app.relaunch', async () => relaunch());

  handle('app.appBooted', async () => {
    // The window is up to show it: finish the update the installed app is behind on.
    if (shellBehind) void completeUpdate();
    // Not left to the first update check: the app the installer replaced is
    // a gigabyte on disk until this runs.
    else void settlePlan();
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
