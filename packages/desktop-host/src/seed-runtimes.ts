import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * First-launch runtime seeding: unpack the Node, Python and Git the installer ships
 * (`runtimes-seed/<platform>-<arch>`, assembled by
 * apps/desktop/scripts/bundle-runtimes-seed.mjs) into `<moxxyHome>/runtimes`,
 * so the agent can run scripts and npm on a computer that has neither. They
 * are unpacked outside the app because `pip install` must be able to write
 * into them. `.runtime.ok` names the archive a folder came from; a folder
 * carrying the same one is left alone, with whatever was installed into it.
 */
export interface SeedRuntimesOptions {
  /** `process.resourcesPath` of the packaged app (contains `runtimes-seed`). */
  readonly resourcesPath: string;
  /** The moxxy home dir (usually `~/.moxxy`). */
  readonly moxxyHome: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly log?: (msg: string) => void;
}

export interface SeedRuntimesResult {
  /** Names of the runtimes unpacked from the installer. */
  readonly copied: ReadonlyArray<string>;
  /** Names of the runtimes already in place. */
  readonly skipped: ReadonlyArray<string>;
}

interface SeedRuntime { readonly name: string; readonly id: string; readonly archive: string }

const RUNTIME_MARKER = '.runtime.ok';
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Git for Windows puts a GNU tar on PATH that reads neither zip nor `C:\` paths; the system one does. */
export function tarCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform !== 'win32') return 'tar';
  return path.win32.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
}

export const runtimesRoot = (moxxyHome: string) => path.join(moxxyHome, 'runtimes');

export async function seedRuntimesFromResources(opts: SeedRuntimesOptions): Promise<SeedRuntimesResult> {
  const platform = opts.platform ?? process.platform;
  const seedDir = path.join(opts.resourcesPath, 'runtimes-seed', `${platform}-${opts.arch ?? process.arch}`);
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const runtime of await readSeedManifest(seedDir)) {
    const target = path.join(runtimesRoot(opts.moxxyHome), runtime.name);
    if ((await readMarker(target)) === runtime.id) {
      skipped.push(runtime.name);
      continue;
    }
    try {
      await unpackRuntime(path.join(seedDir, runtime.archive), target, runtime.id);
    } catch (error) {
      throw new Error(`Could not unpack the bundled ${runtime.name} runtime`, { cause: error });
    }
    copied.push(runtime.name);
  }
  if (copied.length > 0) {
    opts.log?.(`runtimes-seed: unpacked ${copied.join(', ')}` + (skipped.length > 0 ? ` (${skipped.join(', ')} already present)` : ''));
  }
  return { copied, skipped };
}

/** Unpack beside the target, then swap: a crash never leaves half a runtime. */
async function unpackRuntime(archive: string, target: string, id: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const staging = `${target}.seeding-${randomBytes(4).toString('hex')}`;
  try {
    await fs.mkdir(staging);
    // The official archives hold one top-level folder; its content is the runtime.
    // tar runs on this computer, whichever platform the seed is for.
    await run(tarCommand(), ['-xf', archive, '-C', staging, '--strip-components', '1']);
    await fs.writeFile(path.join(staging, RUNTIME_MARKER), `${id}\n`);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function readSeedManifest(seedDir: string): Promise<ReadonlyArray<SeedRuntime>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(seedDir, 'manifest.json'), 'utf8');
  } catch {
    return []; // this app ships no runtimes for this computer
  }
  const runtimes: unknown = (JSON.parse(raw) as { runtimes?: unknown }).runtimes;
  if (!Array.isArray(runtimes)) throw new Error(`runtimes-seed manifest lists no runtimes: ${seedDir}`);
  return runtimes.map((entry: Partial<SeedRuntime>) => {
    const { name, id, archive } = entry;
    if (typeof name !== 'string' || typeof id !== 'string' || typeof archive !== 'string'
      || !PLAIN_NAME.test(name) || !PLAIN_NAME.test(archive) || id.trim() === '') {
      throw new Error(`runtimes-seed manifest has an invalid entry: ${JSON.stringify(entry)}`);
    }
    return { name, id: id.trim(), archive };
  });
}

async function readMarker(dir: string): Promise<string | null> {
  try {
    return (await fs.readFile(path.join(dir, RUNTIME_MARKER), 'utf8')).trim();
  } catch {
    return null;
  }
}

function run(command: string, args: ReadonlyArray<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(command)} failed: ${stderr.trim().slice(-300) || error.message}`, { cause: error }));
      else resolve();
    });
  });
}

type RuntimeName = 'python' | 'node' | 'git';

/** Where each runtime keeps its programs, relative to its folder. */
const PROGRAM_DIRS: Readonly<Record<RuntimeName, (platform: NodeJS.Platform) => ReadonlyArray<string>>> = {
  python: (platform) => (platform === 'win32' ? ['', 'Scripts'] : ['bin']),
  node: (platform) => (platform === 'win32' ? [''] : ['bin']),
  git: () => ['cmd'],
};

const programDirs = (moxxyHome: string, name: RuntimeName, platform: NodeJS.Platform): string[] => {
  const root = path.join(runtimesRoot(moxxyHome), name);
  return existsSync(path.join(root, RUNTIME_MARKER)) ? PROGRAM_DIRS[name](platform).map((dir) => path.join(root, dir)) : [];
};

/** Where macOS keeps the Git of the developer tools; without them `/usr/bin/git` only offers to install them. */
const MAC_DEVELOPER_GIT = ['/Library/Developer/CommandLineTools/usr/bin/git', '/Applications/Xcode.app/Contents/Developer/usr/bin/git'];

/** False only on a Mac whose `git` is the stub that asks to install the developer tools. */
export function hasSystemGit(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'darwin' || MAC_DEVELOPER_GIT.some((file) => existsSync(file));
}

/**
 * The folders of the unpacked runtimes that belong on PATH. Python goes first:
 * a clean Windows or macOS answers `python` with a stub that offers to install
 * it, which would shadow the bundled one. Node and Git go last: the ones the
 * user installed themselves keep winning. The exception is a Mac without the
 * developer tools, where the system `git` is such a stub too.
 */
export function runtimePathDirs(
  moxxyHome: string,
  platform: NodeJS.Platform = process.platform,
  systemGit: boolean = hasSystemGit(platform),
): { first: string[]; last: string[] } {
  const git = programDirs(moxxyHome, 'git', platform);
  return {
    first: [...programDirs(moxxyHome, 'python', platform), ...(systemGit ? [] : git)],
    last: [...programDirs(moxxyHome, 'node', platform), ...(systemGit ? git : [])],
  };
}

/** Puts the unpacked runtimes on PATH for everything this process starts. Idempotent. */
export function activateRuntimes(moxxyHome: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): void {
  const { first, last } = runtimePathDirs(moxxyHome, platform);
  const delimiter = platform === 'win32' ? ';' : ':';
  // Windows spells the variable `Path`; Node's process.env reads it under either name, a copy does not.
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  const own = new Set([...first, ...last]);
  const rest = (env[key] ?? '').split(delimiter).filter((dir) => dir !== '' && !own.has(dir));
  env[key] = [...first, ...rest, ...last].join(delimiter);
  // A login shell rebuilds PATH from the system profile; the Bash tool reads this to put these back in front.
  if (first.length > 0) env.MOXXY_PATH_FIRST = first.join(delimiter);
}

let ready: Promise<void> = Promise.resolve();

/**
 * Unpacks the bundled runtimes and puts them on PATH, in the background of the
 * app's start. It never rejects: a runtime that cannot be unpacked is logged
 * and the app works as it does on a computer without one.
 */
export function prepareBundledRuntimes(opts: SeedRuntimesOptions & { readonly env?: NodeJS.ProcessEnv }): Promise<void> {
  ready = seedRuntimesFromResources(opts)
    .catch((error: unknown) => {
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      opts.log?.(`runtimes-seed: ${error instanceof Error ? error.message : String(error)}${cause}`);
    })
    .then(() => activateRuntimes(opts.moxxyHome, opts.platform, opts.env));
  return ready;
}

/** Resolves once the bundled runtimes are on PATH: wait for it before looking for `node`, `npm` or `python`. */
export const bundledRuntimesReady = (): Promise<void> => ready;
