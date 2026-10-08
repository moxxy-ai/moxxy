/**
 * Everything a packaged launch does before its first runner: finish what a
 * crash cut short, put in place the extensions and the connections the
 * installer carries, then bring from npm whatever is still older than the
 * version the app was built with. Nobody is asked anything; what is done is
 * written down, so an ordinary launch finds nothing to do and starts at once.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { installBundledUpdates, type BundledUpdateResult } from '../bundled-updates.js';
import {
  applyComponentUpdate,
  componentsBehind,
  planComponentUpdate,
  recoverComponentUpdates,
  type NpmCommand,
  type PackageRegistry,
} from '../component-update.js';
import { offerBundledComputerUpdate } from '../computer-update-runtime.js';
import { offerBundledProviderUpdate, type ProviderUpdateOffer } from '../provider-update-runtime.js';
import { seedPluginsFromResources } from '../seed-plugins.js';
import type { StartupSetup } from './setup.js';
import { installerIdentity, readSetupStamp, setupNeeds, writeSetupStamp } from './stamp.js';

const COMPUTER_USE = '@moxxy/plugin-computer-control';
export const NO_NPM = 'npm not found — the runner and extensions cannot be updated without Node.js.';

const LABELS: Readonly<Record<string, string>> = {
  '@moxxy/plugin-provider-openai': 'The OpenAI API connection',
  '@moxxy/plugin-provider-openai-codex': 'ChatGPT sign-in',
  [COMPUTER_USE]: 'Computer Use',
};
const label = (plugin: string): string => LABELS[plugin] ?? plugin;

export interface PrepareInstalledAppOptions {
  /** `process.resourcesPath` of the packaged app. */
  readonly resourcesPath: string;
  readonly moxxyHome: string;
  readonly userDataDir: string;
  /** The installed shell's version (not a hot-updated bundle's). */
  readonly shellVersion: string;
  /** The runner version the running app was built with. */
  readonly componentsVersion: string;
  /** The version of the runner a new session would start. */
  readonly cliVersion: () => string | null;
  readonly registry: PackageRegistry;
  /** Looked up when needed — the bundled runtimes may be what provides it.
   *  Null when npm is not on this machine. */
  readonly npm: () => NpmCommand | null;
  /** Model connections the installer replaces through their own journal. */
  readonly providers: ReadonlyArray<ProviderUpdateOffer['plugin']>;
  /** Computer Use goes the same way where its helper is replaced in place. */
  readonly managedComputer?: boolean;
  readonly setup: StartupSetup;
  /** The bundled runtimes; awaited before anything else. */
  readonly runtimes?: () => Promise<void>;
  /** Runs once the extensions are in place, with the ones newly copied. */
  readonly afterSeed?: (copied: ReadonlyArray<string>) => Promise<void>;
  /** A new runner was installed: new sessions should start it. */
  readonly onComponentsInstalled?: () => void;
  readonly onProgress?: (message: string) => void;
  readonly log?: (message: string) => void;
}

const isDir = (dir: string): Promise<boolean> => fs.stat(dir).then((stat) => stat.isDirectory(), () => false);

export async function prepareInstalledApp(options: PrepareInstalledAppOptions): Promise<void> {
  const { setup, moxxyHome, userDataDir, resourcesPath, componentsVersion } = options;
  try {
    const identity = await installerIdentity(resourcesPath, options.shellVersion);
    if (identity === null) {
      // A build that carries nothing to install (a development run).
      await options.runtimes?.();
      return;
    }
    // A swap a crash cut short is finished (or undone) before anything reads
    // the plugins dir — seeding would otherwise fill a half-swapped one.
    await recoverComponentUpdates({ moxxyHome, userDataDir });
    const stamp = await readSetupStamp(moxxyHome);
    const versions = { cliVersion: options.cliVersion(), moxxyHome, version: componentsVersion };
    const needs = setupNeeds({
      identity,
      stamp,
      componentsVersion,
      componentsBehind: await componentsBehind(versions),
      hasProfile: await isDir(path.join(moxxyHome, 'plugins', 'node_modules')),
    });
    const wants = (id: (typeof needs.steps)[number]): boolean => needs.steps.includes(id);
    setup.begin(needs.reason, needs.steps);

    // Runs on every launch — it only copies what its own record says is missing
    // or older — and shows as a step when the installer is new.
    const seed = await setup.step('extensions', async () => {
      await options.runtimes?.();
      const result = await seedPluginsFromResources({
        resourcesPath,
        moxxyHome,
        managedElsewhere: [...options.providers, ...(options.managedComputer ? [COMPUTER_USE] : [])],
        ...(options.log ? { log: options.log } : {}),
      });
      await options.afterSeed?.(result.copied);
      return result;
    });

    let connections = true;
    if (wants('connections')) {
      const fresh = (plugin: string): boolean => seed?.copied.includes(plugin) ?? false;
      connections = (await setup.step('connections', async () => {
        const results: BundledUpdateResult[] = await installBundledUpdates(
          options.providers.map((plugin) => ({
            plugin,
            run: (confirm) => offerBundledProviderUpdate({ resourcesPath, moxxyHome, plugin, freshInstall: fresh(plugin), confirm }),
          })),
        );
        if (options.managedComputer) {
          results.push(
            ...(await installBundledUpdates([
              {
                plugin: COMPUTER_USE,
                run: (confirm) =>
                  offerBundledComputerUpdate({
                    resourcesPath,
                    moxxyHome,
                    freshInstall: fresh(COMPUTER_USE),
                    confirm,
                    ...(options.log ? { log: options.log } : {}),
                  }),
              },
            ])),
          );
        }
        for (const result of results) {
          options.log?.(`${result.plugin}: ${result.outcome}${result.error ? ` (${result.error})` : ''}`);
          if (result.replacedLocalCopy) {
            setup.note(`${label(result.plugin)} was updated. It had been changed by hand, so the previous copy was kept in ${result.replacedLocalCopy}`);
          }
        }
        const failed = results.filter((result) => result.outcome === 'failed');
        if (failed.length > 0) {
          throw new Error(failed.map((result) => `${label(result.plugin)} kept its previous version (${result.error}).`).join(' '));
        }
        return true;
      })) === true;
    }

    if (wants('components')) {
      await setup.step('components', async () => {
        const plan = await planComponentUpdate({ ...versions, cliVersion: options.cliVersion(), registry: options.registry });
        if (!plan) return;
        const npm = options.npm();
        if (!npm) throw new Error(NO_NPM);
        await applyComponentUpdate({
          plan,
          moxxyHome,
          userDataDir,
          npm,
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        });
        options.onComponentsInstalled?.();
      });
    }

    // A connection that could not be installed is tried again by the next
    // launch; the runner version is tried once (see `setupNeeds`).
    const next = {
      installer: seed !== undefined && connections ? identity : stamp.installer,
      components: wants('components') ? componentsVersion : stamp.components,
    };
    if (next.installer !== stamp.installer || next.components !== stamp.components) await writeSetupStamp(moxxyHome, next);
  } catch (error) {
    options.log?.(`startup setup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setup.finish();
  }
}
