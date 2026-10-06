/**
 * The one-click update of what the desktop runs besides its own bundle: the
 * runner (`@moxxy/cli` in `<userData>/cli`) and the user's `@moxxy` plugins in
 * `~/.moxxy/plugins`. Both follow the latest published CLI version — the
 * release publishes every `@moxxy` package at that one version.
 *
 * Nothing live is touched until the new version is installed and verified: a
 * copy is updated next to the live directory, checked, and swapped in, with
 * the previous copy kept as `<dir>.previous`. A failure anywhere leaves the
 * live directory as it was. Only package code moves — the profile's data
 * (vault, desks, sessions, config) lives outside these directories.
 *
 * Plugins linked to local source or installed from a local file are a
 * developer's own and are left alone, as is anything not under `@moxxy/`.
 */

import { spawn } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { compareSemver, z } from '@moxxy/sdk';
import { resolveExecutableTarget, spawnExecutableTarget } from '@moxxy/sdk/server';
import { augmentedPaths, findExecutable, spawnPath } from './cli-resolver.js';
import { isManagedPackage, recordManagedInstall } from './computer-update.js';
import { chmodNodePtyHelpers } from './node-pty-helpers.js';

export interface PackageRegistry {
  /** The version the registry marks latest, or null when it can't be told. */
  latestVersion(name: string): Promise<string | null>;
  hasVersion(name: string, version: string): Promise<boolean>;
}

export interface NpmCommand {
  /** Runs npm; rejects when it exits non-zero. */
  run(args: ReadonlyArray<string>, onLine?: (line: string) => void): Promise<void>;
}

export interface ComponentUpdatePlan {
  /** The release everything moves to. */
  readonly version: string;
  readonly cli: { readonly current: string | null } | null;
  readonly plugins: ReadonlyArray<{ readonly name: string; readonly current: string }>;
}

const CLI = '@moxxy/cli';
const NPM_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const LOCAL_SPEC = /^(?:file|link|git|git\+[a-z]+|https?|github):/i;
const manifestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    dependencies: z.record(z.string(), z.string()).optional(),
    moxxy: z.object({ plugin: z.object({ entry: z.string() }).partial().optional() }).passthrough().optional(),
  })
  .passthrough();

async function readManifest(dir: string): Promise<z.infer<typeof manifestSchema> | null> {
  try {
    return manifestSchema.parse(JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')));
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

const pluginsDirSchema = z.object({ dependencies: z.record(z.string(), z.string()).optional() }).passthrough();

/** The `@moxxy` packages in the plugins dir that came from the registry. */
async function registryPlugins(pluginsDir: string): Promise<Array<{ name: string; current: string }>> {
  let dependencies: Record<string, string>;
  try {
    const raw: unknown = JSON.parse(await fs.readFile(path.join(pluginsDir, 'package.json'), 'utf8'));
    dependencies = pluginsDirSchema.parse(raw).dependencies ?? {};
  } catch {
    return [];
  }
  const result: Array<{ name: string; current: string }> = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!name.startsWith('@moxxy/') || LOCAL_SPEC.test(spec)) continue;
    const dir = path.join(pluginsDir, 'node_modules', name);
    if (!(await exists(dir)) || (await fs.lstat(dir)).isSymbolicLink()) continue;
    const installed = await readManifest(dir);
    if (installed?.name === name) result.push({ name, current: installed.version });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** What an update would change, or null when everything is current (or the
 *  release can't be looked up). Never installs anything. */
export async function planComponentUpdate(options: {
  readonly cliVersion: string | null;
  readonly moxxyHome: string;
  readonly registry: PackageRegistry;
}): Promise<ComponentUpdatePlan | null> {
  const version = await options.registry.latestVersion(CLI);
  if (!version) return null;
  const behind = (current: string | null) => current === null || compareSemver(version, current) > 0;
  const cli = behind(options.cliVersion) ? { current: options.cliVersion } : null;
  const candidates = (await registryPlugins(path.join(options.moxxyHome, 'plugins'))).filter((p) => behind(p.current));
  const published = await Promise.all(candidates.map((p) => options.registry.hasVersion(p.name, version)));
  const plugins = candidates.filter((_, i) => published[i]);
  return cli || plugins.length > 0 ? { version, cli, plugins } : null;
}

export interface ApplyComponentUpdateOptions {
  readonly plan: ComponentUpdatePlan;
  readonly moxxyHome: string;
  readonly userDataDir: string;
  readonly npm: NpmCommand;
  /** How npm is told which package to install; the registry by default. */
  readonly spec?: (name: string, version: string) => string;
  readonly onProgress?: (message: string) => void;
}

/** Installs the plan. Rejects — with the live directories as they were — when
 *  any part can't be installed or doesn't start. */
export async function applyComponentUpdate(options: ApplyComponentUpdateOptions): Promise<void> {
  const { plan } = options;
  const spec = options.spec ?? ((name: string, version: string) => `${name}@${version}`);
  const progress = options.onProgress ?? (() => undefined);
  if (plan.cli) {
    progress('Updating the runner…');
    await updateCli(options.userDataDir, spec(CLI, plan.version), plan.version, options.npm);
  }
  if (plan.plugins.length > 0) {
    progress('Updating extensions…');
    const names = plan.plugins.map((p) => p.name);
    await updatePlugins(options.moxxyHome, names.map((name) => spec(name, plan.version)), names, options.npm);
    for (const name of names.filter(isManagedPackage)) {
      await recordManagedInstall(options.moxxyHome, name).catch(() => undefined);
    }
  }
}

async function updateCli(userDataDir: string, spec: string, version: string, npm: NpmCommand): Promise<void> {
  const live = path.join(userDataDir, 'cli');
  await replaceVerified(live, false, async (staging) => {
    await npm.run(['install', '--prefix', staging, '--no-audit', '--no-fund', spec]);
    chmodNodePtyHelpers(staging);
    const bin = path.join(staging, 'node_modules', '@moxxy', 'cli', 'dist', 'bin.js');
    const printed = await runProbe([bin, '--version']).catch((error: unknown) => {
      throw new Error(`The updated runner does not start: ${(error as Error).message}`);
    });
    if (!printed.includes(version)) throw new Error(`The updated runner reports "${printed.trim()}", not ${version}`);
  });
}

async function updatePlugins(moxxyHome: string, specs: ReadonlyArray<string>, names: ReadonlyArray<string>, npm: NpmCommand): Promise<void> {
  const live = path.join(moxxyHome, 'plugins');
  await replaceVerified(live, true, async (staging) => {
    await npm.run(['install', '--prefix', staging, '--no-audit', '--no-fund', '--ignore-scripts', '--save-exact', ...specs]);
    chmodNodePtyHelpers(staging);
    for (const name of names) {
      const dir = path.join(staging, 'node_modules', name);
      const entry = (await readManifest(dir))?.moxxy?.plugin?.entry;
      if (!entry) continue;
      await runProbe(['--input-type=module', '-e', PLUGIN_PROBE, path.join(dir, entry)]).catch((error: unknown) => {
        throw new Error(`The updated ${name} does not load: ${(error as Error).message}`);
      });
    }
  });
}

/**
 * Builds the new copy of `live` in a sibling directory (the same depth, so a
 * relative `file:` link still resolves), lets `install` fill and verify it,
 * then swaps it in and keeps the old one as `<live>.previous`.
 */
async function replaceVerified(live: string, fromLive: boolean, install: (staging: string) => Promise<void>): Promise<void> {
  await fs.mkdir(path.dirname(live), { recursive: true });
  const staging = await fs.mkdtemp(`${live}.update-`);
  try {
    if (fromLive && (await exists(live))) {
      await copyTree(live, staging);
    }
    await install(staging);
    const previous = `${live}.previous`;
    await fs.rm(previous, { recursive: true, force: true });
    if (await exists(live)) await fs.rename(live, previous);
    await fs.rename(staging, live);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/**
 * Copies a tree and keeps its links as links. `fs.cp` recreates a directory
 * link as a symlink, which an ordinary Windows account may not create; a
 * junction (what `npm link` itself leaves there) needs no privilege.
 */
async function copyTree(from: string, to: string): Promise<void> {
  const links: string[] = [];
  await fs.cp(from, to, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (source) => {
      if (!(await fs.lstat(source)).isSymbolicLink()) return true;
      links.push(source);
      return false;
    },
  });
  for (const source of links) {
    const target = await fs.readlink(source);
    const copy = path.join(to, path.relative(from, source));
    if (process.platform !== 'win32') {
      await fs.symlink(target, copy);
      continue;
    }
    const resolved = path.resolve(path.dirname(source), target);
    const isDir = (await fs.stat(resolved).catch(() => null))?.isDirectory() ?? false;
    await fs.symlink(isDir ? resolved : target, copy, isDir ? 'junction' : 'file');
  }
}

/** At startup: finishes a swap a crash interrupted and drops unfinished copies. */
export async function recoverComponentUpdates(options: { readonly moxxyHome: string; readonly userDataDir: string }): Promise<void> {
  for (const live of [path.join(options.moxxyHome, 'plugins'), path.join(options.userDataDir, 'cli')]) {
    const previous = `${live}.previous`;
    if (!(await exists(live)) && (await exists(previous))) await fs.rename(previous, live);
    const dir = path.dirname(live);
    if (!(await exists(dir))) continue;
    for (const name of await fs.readdir(dir)) {
      if (name.startsWith(`${path.basename(live)}.update-`)) await fs.rm(path.join(dir, name), { recursive: true, force: true });
    }
  }
}

// Loads the updated entry the way the runner will. What it exports depends on
// the plugin's kind (a plugin object, or a function the runner builds it
// with), so the check is that it loads and exports something.
const PLUGIN_PROBE = `import {pathToFileURL} from 'node:url';
const mod=await import(pathToFileURL(process.argv[1]).href);
if(Object.keys(mod).length===0) throw Error('the entry exports nothing');
console.log('ok');`;

/** Runs Node (Electron's own, as Node, inside the app) and returns its output. */
function runProbe(args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => (out += b.toString()));
    child.stderr.on('data', (b: Buffer) => (err += b.toString()));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(errorLine(err) || `exit code ${code}`));
    });
  });
}

const lastLine = (text: string): string => text.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
/** The thrown error in Node's output — it ends with its own version line. */
const errorLine = (text: string): string =>
  text.split(/\r?\n/).find((line) => /^\w*Error\b/.test(line.trim()))?.trim() ?? lastLine(text);
/** npm's own reason — its error lines, not the "complete log" pointer. */
const npmReason = (text: string): string => {
  const lines = text.split(/\r?\n/).filter((line) => /^npm error (?!A complete log)\S/.test(line));
  return lines.length > 0 ? lines.map((line) => line.slice('npm error '.length)).join(' ').slice(0, 400) : lastLine(text);
};

/** npm as found for a GUI launch (its own dir on PATH for the `node` shebang). */
export function findNpm(): NpmCommand | null {
  const npm = findExecutable('npm', augmentedPaths());
  if (!npm) return null;
  return {
    run: (args, onLine) =>
      new Promise<void>((resolve, reject) => {
        const target = resolveExecutableTarget(npm);
        if (!target) {
          reject(new Error(`npm disappeared: ${npm}`));
          return;
        }
        const child = spawnExecutableTarget(target, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: spawnPath([path.dirname(npm)]) },
        });
        let tail = '';
        const read = (b: Buffer) => {
          const text = b.toString();
          tail = (tail + text).slice(-2_000);
          for (const line of text.split(/\r?\n/)) if (line) onLine?.(line);
        };
        const timer = setTimeout(() => child.kill(), NPM_TIMEOUT_MS);
        child.stdout?.on('data', read);
        child.stderr?.on('data', read);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`npm ${args[0]} failed (exit ${code}): ${npmReason(tail)}`));
        });
      }),
  };
}

/** The public npm registry. Any failure reads as "can't tell". */
export function npmRegistry(fetchImpl: typeof fetch = fetch): PackageRegistry {
  const get = async (name: string, tag: string): Promise<string | null> => {
    try {
      const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { version?: unknown };
      return typeof body.version === 'string' && /^\d+\.\d+\.\d+$/.test(body.version) ? body.version : null;
    } catch {
      return null;
    }
  };
  return {
    latestVersion: (name) => get(name, 'latest'),
    hasVersion: async (name, version) => (await get(name, version)) === version,
  };
}
