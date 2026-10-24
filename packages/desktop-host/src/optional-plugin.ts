import type { ChildProcess } from 'node:child_process';
import { access, open } from 'node:fs/promises';
import path from 'node:path';

import { z } from '@moxxy/sdk';
import { moxxyHome } from '@moxxy/sdk/server';

import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';
import { repairSeededPluginManifest } from './seed-plugins';

/**
 * A first-party plugin Settings offers to switch on: the installer usually
 * ships it in the plugin seed, else it comes from npm. Everything here is
 * host-owned, so the renderer cannot choose a package, contribution or flag.
 */
export interface OptionalPlugin {
  /** npm name, e.g. `@moxxy/plugin-tts-local`. */
  readonly packageName: `@moxxy/${string}`;
  /** The plugin category its contribution is the default of. */
  readonly category: 'synthesizer' | 'transcriber';
  /** The contribution made the category default, e.g. `local-piper`. */
  readonly contribution: string;
  /** What the package is, for errors: "The <label> package could not be installed". */
  readonly label: string;
}

export type OptionalPluginCliRunner = (args: ReadonlyArray<string>) => Promise<void>;

export interface OptionalPluginInstallerOptions {
  readonly runCommand?: OptionalPluginCliRunner;
  readonly repairManifest?: () => Promise<unknown>;
  readonly isInstalled?: () => Promise<boolean>;
}

const PLUGIN_ENTRY = './dist/index.js';
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_INSTALL_ERROR_BYTES = 4 * 1024;

/**
 * Probe the package by its fixed first-party path and manifest. A dependency
 * entry alone is not enough: interrupted npm installs can leave a package
 * directory without the compiled discovery entry.
 */
export async function isOptionalPluginInstalled(
  plugin: OptionalPlugin,
  home = moxxyHome(),
): Promise<boolean> {
  const packageDirectory = path.join(home, 'plugins', 'node_modules', ...plugin.packageName.split('/'));
  const manifestSchema = z.object({
    name: z.literal(plugin.packageName),
    moxxy: z.object({
      plugin: z.object({ entry: z.literal(PLUGIN_ENTRY) }).passthrough(),
    }).passthrough(),
  }).passthrough();
  let handle: import('node:fs/promises').FileHandle | null = null;
  try {
    handle = await open(path.join(packageDirectory, 'package.json'), 'r');
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_MANIFEST_BYTES) return false;
    const parsed = manifestSchema.safeParse(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
    if (!parsed.success) return false;
    await access(path.join(packageDirectory, 'dist', 'index.js'));
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Build a single-flight installer that installs the package when missing, then
 * enables it and makes its contribution the category default. Every command
 * uses argv spawning of the bundled CLI, never a shell.
 */
export function createOptionalPluginInstaller(
  plugin: OptionalPlugin,
  options: OptionalPluginInstallerOptions = {},
): () => Promise<void> {
  const runCommand = options.runCommand ?? cliRunner(plugin.label);
  const repairManifest = options.repairManifest ?? (() => (
    repairSeededPluginManifest(path.join(moxxyHome(), 'plugins'))
  ));
  const isInstalled = options.isInstalled ?? (() => isOptionalPluginInstalled(plugin));
  let inFlight: Promise<void> | null = null;
  return (): Promise<void> => {
    if (inFlight) return inFlight;
    const started = installOptionalPlugin(plugin, runCommand, repairManifest, isInstalled);
    const tracked = started.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}

async function installOptionalPlugin(
  plugin: OptionalPlugin,
  runCommand: OptionalPluginCliRunner,
  repairManifest: () => Promise<unknown>,
  isInstalled: () => Promise<boolean>,
): Promise<void> {
  // The installer ships the package, so the usual case needs neither npm nor network.
  if (!(await isInstalled())) {
    await repairManifest();
    await runCommand(['plugins', 'install', plugin.packageName]);
  }
  await runCommand(['plugins', 'enable', plugin.packageName]);
  await runCommand(['plugins', 'set-default', plugin.category, plugin.contribution]);
}

function cliRunner(label: string): OptionalPluginCliRunner {
  return async (args) => {
    const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
    if (!cli) throw new Error('The bundled Moxxy CLI is unavailable.');
    const child = spawnCli(cli, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const result = await waitForCommand(child);
    if (result.code === 0) return;
    const detail = compactInstallError(result.stderr);
    throw new Error(
      detail
        ? `The ${label} package could not be installed: ${detail}`
        : `The ${label} package could not be installed. Check your internet connection and try again.`,
    );
  };
}

function waitForCommand(
  child: ChildProcess,
): Promise<{ readonly code: number | null; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_INSTALL_ERROR_BYTES) {
        stderr = stderr.slice(-MAX_INSTALL_ERROR_BYTES);
      }
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stderr });
    });
  });
}

function compactInstallError(stderr: string): string {
  return stderr
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(' ')
    .slice(0, 1_200);
}
