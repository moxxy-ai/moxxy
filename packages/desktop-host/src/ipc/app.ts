/**
 * App-level (non per-workspace) handlers: updating what the desktop runs
 * besides its own bundle — the runner (`@moxxy/cli`) and the `@moxxy`
 * extensions in `~/.moxxy/plugins`.
 *
 * The desktop ships a pinned, bundled `@moxxy/cli` but prefers a newer copy
 * under `<userData>/cli` (see the MOXXY_CLI_ENTRY block in the Electron main).
 * Every update goes through {@link applyComponentUpdate}: installed and
 * verified next to the live copy, swapped in only then.
 *
 * The version they go to is the one the running app was built with — the
 * launch after an app update does it by itself (`startup-setup`); these
 * handlers are the way to try again by hand when that could not be done.
 */

import { app, BrowserWindow as BrowserWindowApi } from 'electron';
import { moxxyHome } from '@moxxy/sdk/server';
import type { AppUpdateProgress, ComponentUpdateCheck } from '@moxxy/desktop-ipc-contract';

import type { RunnerPool } from '../runner-pool';
import { getCliVersion } from '../installer';
import { preferredCliEntry } from '../cli-resolver';
import {
  applyComponentUpdate,
  findNpm,
  npmRegistry,
  planComponentUpdate,
  type ComponentUpdatePlan,
} from '../component-update';
import { sendEvent } from '../send-event';
import { wsEventBus } from '../event-bus';
import { NO_NPM } from '../startup-setup/index.js';
import { handle } from './shared';

/** The runner version the running app was built with; null in a build that does not say. */
let builtWithVersion: string | null = null;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const focusedWindow = () => BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];

async function planUpdate(): Promise<ComponentUpdatePlan | null> {
  if (!builtWithVersion) return null;
  return planComponentUpdate({ cliVersion: getCliVersion(), moxxyHome: moxxyHome(), registry: npmRegistry(), version: builtWithVersion });
}

/** One update at a time: a second request waits for the running one. */
let updating: Promise<unknown> = Promise.resolve();

function install(plan: ComponentUpdatePlan, onLine?: (line: string) => void): Promise<void> {
  const run = async (): Promise<void> => {
    const npm = findNpm();
    if (!npm) throw new Error(NO_NPM);
    const userData = app.getPath('userData');
    await applyComponentUpdate({
      plan,
      moxxyHome: moxxyHome(),
      userDataDir: userData,
      npm: { run: (args) => npm.run(args, onLine) },
      onProgress: (message) => {
        const progress: AppUpdateProgress = { phase: 'install', message };
        const target = focusedWindow();
        if (target) sendEvent(target, 'app.update.progress', progress);
        wsEventBus.broadcast('app.update.progress', progress);
      },
    });
    // Point new runners at the updated copy, the same way the boot block does.
    const entry = preferredCliEntry(userData, process.resourcesPath ?? '');
    if (entry) process.env.MOXXY_CLI_ENTRY = entry;
  };
  const next = updating.then(run, run);
  updating = next.catch(() => undefined);
  return next;
}

/** Whether the runner or the installed `@moxxy` extensions are behind the
 *  version this app was built with. Never rejects: what stops the check comes
 *  back in `error`. */
async function checkComponentUpdate(): Promise<ComponentUpdateCheck> {
  const none = { available: false, version: null, runner: null, extensions: [] };
  // A dev build runs the repo's runner against the real ~/.moxxy: updating
  // its extensions from npm would replace what the developer is testing.
  if (!app.isPackaged) return { ...none, error: 'Updates run only in the packaged app.' };
  if (!findNpm()) return { ...none, error: NO_NPM };
  try {
    const plan = await planUpdate();
    if (!plan) return none;
    return { available: true, version: plan.version, runner: plan.cli, extensions: plan.plugins };
  } catch (error) {
    return { ...none, error: errorMessage(error) };
  }
}

export function registerAppHandlers(pool: RunnerPool, componentsVersion?: string): void {
  builtWithVersion = componentsVersion ?? null;
  const restartRunners = (): Promise<unknown> => Promise.all(pool.list().map((e) => e.supervisor.restart()));

  handle('app.cliInfo', async () => ({
    version: getCliVersion(),
    path: process.env.MOXXY_CLI_ENTRY ?? null,
  }));

  handle('app.checkComponents', checkComponentUpdate);
  // Brings the runner and extensions to that version and restarts the runners
  // onto them; `updated` says whether anything was installed.
  handle('app.updateComponents', async () => {
    if (!app.isPackaged) return { ok: false, updated: false, error: 'Updates run only in the packaged app.' };
    try {
      const plan = await planUpdate();
      if (!plan) return { ok: true, updated: false };
      await install(plan);
      await restartRunners();
      return { ok: true, updated: true };
    } catch (error) {
      return { ok: false, updated: false, error: errorMessage(error) };
    }
  });

  // The connection screen's "Update CLI & reconnect": the runner alone, then
  // every runner restarts onto it.
  handle('app.updateCli', async () => {
    const target = focusedWindow();
    const emit = (line: string): void => {
      if (target) sendEvent(target, 'onboarding.install.progress', line);
      wsEventBus.broadcast('onboarding.install.progress', line);
    };
    try {
      const version = builtWithVersion ?? (await npmRegistry().latestVersion('@moxxy/cli'));
      if (!version) throw new Error('The runner version could not be looked up — check the internet connection.');
      emit(`Installing @moxxy/cli ${version}…`);
      await install({ version, cli: { current: getCliVersion() }, plugins: [] }, emit);
      await restartRunners();
      return { code: 0, version: getCliVersion() };
    } catch (error) {
      emit(errorMessage(error));
      return { code: 1, version: getCliVersion() };
    }
  });
}
