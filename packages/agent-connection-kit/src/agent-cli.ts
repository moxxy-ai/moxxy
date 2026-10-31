import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentCliOrigin, AgentCliReport } from '@moxxy/sdk';
import {
  fetchNpmLatest,
  findExecutable,
  killTree,
  moxxyPath,
  spawnExecutableTarget,
  writeFileAtomic,
  type ExecutableTarget,
} from '@moxxy/sdk/server';
import { compareVersions, readCliVersion } from './cli-version.js';

/**
 * The agent CLIs Moxxy connects to, and how each one is found, checked,
 * installed and updated — always with the vendor's own commands, so Moxxy
 * never has to know which package manager put a CLI on the computer.
 */
export interface AgentCliDescriptor {
  /** The agent as the person knows it ("Codex"). */
  readonly name: string;
  readonly command: string;
  /** The variable that points at another file to run (`CODEX_EXECUTABLE`); every lookup honours it. */
  readonly executableEnv: string;
  /** The npm package whose `latest` tag is the vendor's newest release. */
  readonly npmPackage: string;
  /** The oldest version Moxxy was checked against; older ones must be updated first. */
  readonly minimumVersion: string;
  /** npm packages of older releases, which the agent's own update still handles (OpenCode 1). */
  readonly legacyNpmPackages?: ReadonlyArray<string>;
  /** Arguments to the CLI itself that update it, however it was installed. */
  readonly updateArgs: ReadonlyArray<string>;
  /**
   * Arguments that move the CLI to the vendor's next major release, for a
   * vendor whose plain update stays within the installed one (OpenCode 1).
   */
  readonly majorUpdateArgs?: ReadonlyArray<string>;
  /**
   * Where the vendor's installer reads its newest version, which can lag npm;
   * `channel` is the person's choice, read from `channelSetting` under the home.
   */
  readonly releaseChannel?: {
    readonly url: (channel: string) => string;
    readonly settingsFile: string;
    readonly setting: string;
    readonly fallback: string;
  };
  /** The vendor's installer, as a POSIX shell line and as a PowerShell line. */
  readonly install: { readonly posix: string; readonly windows: string };
  /**
   * Folders under the home the vendor's installer puts the CLI in. Searched
   * after PATH: a desktop app often starts without the shell profile's PATH,
   * and a CLI installed a minute ago is not on it until a new terminal opens.
   */
  readonly installDirs: ReadonlyArray<string>;
  /** Extra environment for the installer, e.g. to keep it from asking anything. */
  readonly installEnv?: Readonly<Record<string, string>>;
  /**
   * What a Windows npm install's `.cmd` shim runs, relative to the shim's
   * folder: a Node script or a native program. Only a shell runs the shim
   * itself, and Moxxy starts no shell. `native` lists the programs a script
   * entry would start, tried first: the script starts its program without
   * hiding its window, so Windows would open a console for it.
   */
  readonly windowsShim: {
    readonly entry: string;
    readonly runs: 'node' | 'native';
    readonly native?: (arch: string) => ReadonlyArray<WindowsNativeProgram>;
  };
}

/** A native program behind a Windows npm shim. */
export interface WindowsNativeProgram {
  /** Relative to the shim's folder, `/`-separated. */
  readonly path: string;
  /** What the script that would start it sets, given the shim's folder. */
  readonly env?: (shimDir: string) => Readonly<Record<string, string>>;
}

export const CLAUDE_CLI: AgentCliDescriptor = {
  name: 'Claude Code',
  command: 'claude',
  executableEnv: 'CLAUDE_CODE_EXECUTABLE',
  npmPackage: '@anthropic-ai/claude-code',
  minimumVersion: '2.1.296',
  updateArgs: ['update'],
  releaseChannel: {
    url: (channel) => `https://downloads.claude.ai/claude-code-releases/${encodeURIComponent(channel)}`,
    settingsFile: '.claude/settings.json',
    setting: 'autoUpdatesChannel',
    fallback: 'latest',
  },
  install: { posix: 'curl -fsSL https://claude.ai/install.sh | bash', windows: 'irm https://claude.ai/install.ps1 | iex' },
  installDirs: ['.local/bin'],
  windowsShim: { entry: 'node_modules/@anthropic-ai/claude-code/cli.js', runs: 'node' },
};

/** Codex's own program for each Windows CPU, as its codex.js picks it. */
const CODEX_WINDOWS_BUILDS: Readonly<Record<string, { readonly pkg: string; readonly triple: string }>> = {
  x64: { pkg: 'codex-win32-x64', triple: 'x86_64-pc-windows-msvc' },
  arm64: { pkg: 'codex-win32-arm64', triple: 'aarch64-pc-windows-msvc' },
};

/** Where npm puts that program: inside Codex, beside it, or (older releases) in Codex's own `vendor`. */
function codexWindowsPrograms(arch: string): ReadonlyArray<WindowsNativeProgram> {
  const build = CODEX_WINDOWS_BUILDS[arch];
  if (!build) return [];
  const program = `vendor/${build.triple}/bin/codex.exe`;
  const env = (shimDir: string) => ({
    CODEX_MANAGED_BY_NPM: '1',
    CODEX_MANAGED_PACKAGE_ROOT: path.win32.join(shimDir, 'node_modules', '@openai', 'codex'),
  });
  return [
    `node_modules/@openai/codex/node_modules/@openai/${build.pkg}/${program}`,
    `node_modules/@openai/${build.pkg}/${program}`,
    `node_modules/@openai/codex/${program}`,
  ].map((relative) => ({ path: relative, env }));
}

export const CODEX_CLI: AgentCliDescriptor = {
  name: 'Codex',
  command: 'codex',
  executableEnv: 'CODEX_EXECUTABLE',
  npmPackage: '@openai/codex',
  minimumVersion: '0.155.1',
  updateArgs: ['update'],
  install: {
    posix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    windows: 'irm https://chatgpt.com/codex/install.ps1 | iex',
  },
  installDirs: ['.local/bin'],
  // The installer otherwise offers to start Codex and to remove other installs.
  installEnv: { CODEX_NON_INTERACTIVE: '1' },
  windowsShim: { entry: 'node_modules/@openai/codex/bin/codex.js', runs: 'node', native: codexWindowsPrograms },
};

export const OPENCODE_CLI: AgentCliDescriptor = {
  name: 'OpenCode',
  command: 'opencode',
  executableEnv: 'OPENCODE_EXECUTABLE',
  npmPackage: '@opencode/cli',
  legacyNpmPackages: ['opencode-ai'],
  minimumVersion: '1.19.0',
  updateArgs: ['upgrade'],
  // OpenCode 1's `upgrade` stays on 1; `--major` replaces it with OpenCode 2 the way it was installed.
  majorUpdateArgs: ['upgrade', '--major'],
  // OpenCode's install script is POSIX only; on Windows it ships through npm. `/install` still installs OpenCode 1.
  install: { posix: 'curl -fsSL https://opencode.ai/v2/install | bash', windows: 'npm install -g @opencode/cli' },
  installDirs: ['.opencode/bin'],
  // OpenCode 2 is published as @opencode/cli; OpenCode 1 as opencode-ai.
  windowsShim: {
    entry: 'node_modules/opencode-ai/bin/opencode.exe',
    runs: 'native',
    native: () => [{ path: 'node_modules/@opencode/cli/bin/opencode.exe' }],
  },
};

/** The agent CLI behind each agent connection, by provider name. */
export const AGENT_CLIS: Readonly<Record<string, AgentCliDescriptor>> = {
  'claude-code': CLAUDE_CLI,
  'codex-agent': CODEX_CLI,
  opencode: OPENCODE_CLI,
};

/** Where to look for a CLI; every field defaults to this process's own. */
export interface AgentCliSearch {
  /** The command to run instead of the descriptor's, e.g. from `CODEX_EXECUTABLE`. */
  readonly command?: string;
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
  readonly pathEnv?: string;
  /** The PATH folders added only as a fallback; defaults to {@link PATH_FALLBACK_ENV}. */
  readonly fallbackPathEnv?: string;
}

/**
 * Names the folders the desktop put on a runner's PATH only because it could
 * not read the terminal's PATH (`/opt/homebrew/bin`, `/usr/local/bin`, ...).
 * The terminal never chose them, so an agent CLI there comes after the copy
 * the vendor's installer put in place: an old Homebrew `claude` must not win
 * over the current one in `~/.local/bin`.
 */
export const PATH_FALLBACK_ENV = 'MOXXY_PATH_FALLBACK';

function searchOptions(desc: AgentCliDescriptor, opts: AgentCliSearch) {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const delimiter = platform === 'win32' ? ';' : ':';
  const key = (dir: string) => {
    let end = dir.trim();
    while (end.length > 1 && (end.endsWith('/') || end.endsWith('\\'))) end = end.slice(0, -1);
    return platform === 'win32' ? end.toLowerCase() : end;
  };
  const fallback = new Set(
    (opts.fallbackPathEnv ?? process.env[PATH_FALLBACK_ENV] ?? '').split(delimiter).filter(Boolean).map(key),
  );
  const onPath = (opts.pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const chosen = onPath.filter((dir) => !fallback.has(key(dir)));
  return {
    command: opts.command ?? (process.env[desc.executableEnv]?.trim() || desc.command),
    platform,
    dirs: [
      ...chosen,
      ...desc.installDirs.map((dir) => paths.join(home, ...dir.split('/'))),
      ...onPath.filter((dir) => fallback.has(key(dir))),
    ],
  };
}

/**
 * The CLI's file: on PATH first, as a terminal would run it, then where the
 * vendor's installer puts it, then in the folders added only as a fallback.
 */
export function findAgentCli(desc: AgentCliDescriptor, opts: AgentCliSearch = {}): string | null {
  const { command, dirs, platform } = searchOptions(desc, opts);
  return findExecutable(command, dirs, { platform, pathEnv: '' });
}

/** Where a CLI's file came from, and what an update needs to know of it. */
export interface AgentCliSource {
  readonly origin: AgentCliOrigin;
  /** For `app`: the app it is part of ("ChatGPT.app"). */
  readonly app?: string;
  /** For `homebrew`: the Homebrew folder it belongs to, and the formula or cask. */
  readonly homebrew?: { readonly prefix: string; readonly name: string; readonly cask: boolean };
  /** For `winget`: the package it belongs to. */
  readonly winget?: { readonly id: string };
  /** For `npm`: the global prefix the package sits under, when its layout proves one. */
  readonly npmPrefix?: string;
}

export interface AgentCliOriginOptions {
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
  /** Follows links to the real file; defaults to the file system's. */
  readonly realpath?: (file: string) => string;
}

/**
 * Where the CLI at `file` came from, by where it really is: inside a macOS
 * app (`*.app/Contents/`, which the app updates itself), in a Homebrew
 * `Caskroom` or `Cellar`, in a global npm install of the vendor's package, or
 * in a folder the vendor's installer uses. Anything else is unknown.
 */
export function agentCliOrigin(desc: AgentCliDescriptor, file: string, opts: AgentCliOriginOptions = {}): AgentCliSource {
  const platform = opts.platform ?? process.platform;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  let real = file;
  try {
    real = (opts.realpath ?? realpathSync)(file);
  } catch {
    // A file that cannot be followed is judged by where it was found.
  }
  const comparable = (p: string) => (platform === 'win32' ? p.replaceAll('\\', '/').toLowerCase() : p);
  if (platform === 'darwin') {
    for (const candidate of [file, real]) {
      const at = candidate.indexOf('.app/Contents/');
      if (at >= 0) return { origin: 'app', app: path.posix.basename(candidate.slice(0, at + '.app'.length)) };
    }
  }
  const slashed = real.replaceAll('\\', '/');
  const seen = [file.replaceAll('\\', '/').toLowerCase(), slashed.toLowerCase()];
  const manager = PACKAGE_TOOLS.find((tool) => seen.some((p) => tool.owns.test(p)));
  if (manager) return { origin: manager.origin };
  const npmPrefix = npmGlobalPrefix(slashed, desc.npmPackage);
  if (npmPrefix) return { origin: 'npm', npmPrefix };
  if (seen.some((p) => MISE_PATH.test(p))) return { origin: 'mise' };
  for (const [folder, cask] of [['Caskroom', true], ['Cellar', false]] as const) {
    const marker = `/${folder}/`;
    const at = slashed.lastIndexOf(marker);
    const name = at > 0 ? slashed.slice(at + marker.length).split('/')[0] : undefined;
    if (name) return { origin: 'homebrew', homebrew: { prefix: real.slice(0, at), name, cask } };
  }
  const winget = /\/Microsoft\/WinGet\/Packages\/([^/_]+)_/i.exec(slashed);
  if (winget?.[1]) return { origin: 'winget', winget: { id: winget[1] } };
  if (comparable(slashed).includes(comparable(`/node_modules/${desc.npmPackage}/`))) return { origin: 'npm' };
  const home = opts.home ?? homedir();
  const folder = comparable(paths.dirname(file));
  if (desc.installDirs.some((dir) => comparable(paths.join(home, ...dir.split('/'))) === folder)) return { origin: 'installer' };
  return { origin: 'unknown' };
}

/** Global installs of package tools, by the folders each keeps them in. */
const PACKAGE_TOOLS: ReadonlyArray<{
  readonly origin: AgentCliOrigin;
  readonly owns: RegExp;
  readonly command: string;
  readonly args: (pkg: string) => ReadonlyArray<string>;
}> = [
  {
    origin: 'vite-plus',
    owns: /\/(?:\.vite-plus|\.local\/share\/vite-plus|appdata\/local\/vite-plus)\/bin\//,
    command: 'vp',
    args: (pkg) => ['i', '-g', pkg],
  },
  { origin: 'bun', owns: /\/\.bun\/bin\//, command: 'bun', args: (pkg) => ['i', '-g', `${pkg}@latest`] },
  {
    origin: 'pnpm',
    owns: /\/(?:\.local\/share\/pnpm|library\/pnpm|local\/share\/pnpm|appdata\/local\/pnpm|pnpm\/global)\//,
    command: 'pnpm',
    args: (pkg) => ['add', '-g', `${pkg}@latest`],
  },
  { origin: 'yarn', owns: /\/yarn\/(?:data\/)?global\/node_modules\//, command: 'yarn', args: (pkg) => ['global', 'add', `${pkg}@latest`] },
  { origin: 'volta', owns: /\/\.volta\/bin\//, command: 'volta', args: (pkg) => ['install', `${pkg}@latest`] },
];

const MISE_PATH = /\/mise\/(?:installs|shims)\//;

/** The npm prefix of `real`; null for anything npm's global layout does not prove, such as a mise tool of its own. */
function npmGlobalPrefix(real: string, pkg: string): string | null {
  const lower = real.toLowerCase();
  const at = lower.lastIndexOf(`/lib/node_modules/${pkg.toLowerCase()}/`);
  if (at < 0 || lower.slice(0, at).includes('/node_modules/')) return null;
  const mise = /\/mise\/installs\/([^/]+)\/[^/]+$/.exec(lower.slice(0, at))?.[1];
  if (mise && mise !== 'node') return null;
  return at === 0 ? '/' : real.slice(0, at);
}

/** How a copy gets updated. */
export type AgentCliUpdatePlan =
  | { readonly kind: 'own' }
  | { readonly kind: 'run'; readonly command: string; readonly args: ReadonlyArray<string> }
  /** Moxxy must not touch it; `hint` says what the person does. */
  | { readonly kind: 'manual'; readonly hint: string };

/**
 * Who may update the copy at `file`: the tool that owns it when that is
 * proven, the agent's own command when the copy is the vendor's, and the
 * person when neither is sure, so an update never lands on another install.
 * Homebrew, winget and apps are handled where the update runs.
 */
export function agentCliUpdatePlan(
  desc: AgentCliDescriptor,
  file: string,
  source: AgentCliSource,
  platform: NodeJS.Platform = process.platform,
): AgentCliUpdatePlan {
  const tool = PACKAGE_TOOLS.find((candidate) => candidate.origin === source.origin);
  if (tool) {
    const args = tool.args(desc.npmPackage);
    // These tools are `.cmd` shims on Windows, which Moxxy starts without a shell.
    return platform === 'win32'
      ? { kind: 'manual', hint: `run ${[tool.command, ...args].join(' ')}` }
      : { kind: 'run', command: tool.command, args };
  }
  if (source.origin === 'mise') return { kind: 'manual', hint: 'update it with mise' };
  if (source.npmPrefix) {
    const args = ['install', '-g', '--prefix', source.npmPrefix, `--allow-scripts=${desc.npmPackage}`, `${desc.npmPackage}@latest`];
    return platform === 'win32' ? { kind: 'manual', hint: `run npm ${args.join(' ')}` } : { kind: 'run', command: 'npm', args };
  }
  const slashed = file.replaceAll('\\', '/').toLowerCase();
  if (desc.legacyNpmPackages?.some((pkg) => slashed.includes(`/node_modules/${pkg.toLowerCase()}/`))) return { kind: 'own' };
  if (source.origin === 'unknown' && slashed.includes('/node_modules/')) {
    return { kind: 'manual', hint: `update the project or tool that installed it (${desc.npmPackage})` };
  }
  return { kind: 'own' };
}

export interface AgentCliTargetOptions {
  readonly platform?: NodeJS.Platform;
  readonly exists?: (file: string) => boolean;
  readonly electron?: boolean;
  /** The CPU whose native program to look for; defaults to this one's. */
  readonly arch?: string;
}

const WINDOWS_NATIVE = new Set(['.exe', '.com']);
const WINDOWS_SHIMS = new Set(['.cmd', '.bat', '.ps1']);

/** How to run the CLI found at `found` without a shell: as it is, or, behind a Windows npm shim, what the shim runs. */
export function agentCliTargetAt(desc: AgentCliDescriptor, found: string, opts: AgentCliTargetOptions = {}): ExecutableTarget {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'win32') return { kind: 'direct', command: found };
  const extension = path.win32.extname(found).toLowerCase();
  if (WINDOWS_NATIVE.has(extension)) return { kind: 'direct', command: found };
  if (!WINDOWS_SHIMS.has(extension)) throw new Error(`Cannot run ${desc.name} from ${found}; install it again or point at ${desc.command}.exe.`);
  const dir = path.win32.dirname(found);
  const at = (relative: string): string => path.win32.join(dir, ...relative.split('/'));
  const exists = opts.exists ?? existsSync;
  for (const program of desc.windowsShim.native?.(opts.arch ?? process.arch) ?? []) {
    const command = at(program.path);
    if (exists(command)) return program.env ? { kind: 'direct', command, env: program.env(dir) } : { kind: 'direct', command };
  }
  const entry = at(desc.windowsShim.entry);
  if (!exists(entry)) throw new Error(`Cannot find ${entry} behind ${found}; reinstall ${desc.name}.`);
  if (desc.windowsShim.runs === 'native') return { kind: 'direct', command: entry };
  const electron = opts.electron ?? Boolean(process.versions.electron);
  return { kind: 'node', command: process.execPath, entry, env: electron ? { ELECTRON_RUN_AS_NODE: '1' } : {} };
}

export interface LatestVersionOptions {
  readonly refresh?: boolean;
  readonly cacheFile?: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly fetchLatest?: (pkg: string) => Promise<string | null>;
}

const HOUR_MS = 60 * 60_000;
const SOURCE_TIMEOUT_MS = 20_000;

interface LatestEntry {
  readonly version: string;
  readonly at: number;
  /** The newest version an update ran for and did not bring; not offered again. */
  readonly notBrought?: string;
}

type LatestCache = Record<string, LatestEntry>;

/** Where an install gets its updates, so Moxxy offers only what its Update can bring. */
export interface AgentVersionSource {
  /** Names it in the shared cache. */
  readonly key: string;
  readonly fetch: () => Promise<string | null>;
}

export interface AgentVersionSourceOptions {
  readonly home?: string;
  readonly fetchImpl?: typeof fetch;
  /** Runs a program and gives its output; defaults to starting it without a shell. */
  readonly run?: (command: string, args: ReadonlyArray<string>) => Promise<string>;
}

/** The newest version `source`'s way of updating offers: its channel, Homebrew, winget, else npm. */
export function agentVersionSource(
  desc: AgentCliDescriptor,
  source: AgentCliSource,
  opts: AgentVersionSourceOptions = {},
): AgentVersionSource {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (source.origin === 'homebrew' && source.homebrew) {
    const { name, cask } = source.homebrew;
    const url = `https://formulae.brew.sh/api/${cask ? 'cask' : 'formula'}/${encodeURIComponent(name)}.json`;
    return {
      key: `homebrew:${cask ? 'cask' : 'formula'}:${name}`,
      fetch: async () => {
        const json = (await readUrl(url, fetchImpl).then((text) => JSON.parse(text ?? 'null') as unknown).catch(() => null)) as
          | { version?: unknown; versions?: { stable?: unknown } }
          | null;
        const version = cask ? json?.version : json?.versions?.stable;
        return typeof version === 'string' ? version.split(',')[0] ?? null : null;
      },
    };
  }
  if (source.origin === 'winget' && source.winget) {
    const { id } = source.winget;
    const run = opts.run ?? runForOutput;
    return {
      key: `winget:${id}`,
      fetch: async () => {
        const output = await run('winget', wingetArgs('show', id)).catch(() => '');
        // The labels follow the system's language; only the version line is a label and a bare version.
        return /^[^:\r\n]+:\s*v?(\d+(?:\.\d+)+)\s*$/m.exec(output)?.[1] ?? null;
      },
    };
  }
  const channel = desc.releaseChannel;
  if (source.origin === 'installer' && channel) {
    return {
      key: `channel:${desc.command}`,
      fetch: async () => {
        const url = channel.url(await chosenChannel(channel, opts.home ?? homedir()));
        const text = await readUrl(url, fetchImpl).catch(() => null);
        return text && /^\d+(\.\d+)+/.test(text.trim()) ? text.trim() : null;
      },
    };
  }
  return { key: desc.npmPackage, fetch: () => fetchNpmLatest(desc.npmPackage, { fetchImpl }) };
}

function wingetArgs(command: 'show' | 'upgrade', id: string): ReadonlyArray<string> {
  return [command, '--id', id, '--exact', '--disable-interactivity', '--accept-source-agreements'];
}

async function chosenChannel(channel: NonNullable<AgentCliDescriptor['releaseChannel']>, home: string): Promise<string> {
  try {
    const settings: unknown = JSON.parse(await readFile(path.join(home, ...channel.settingsFile.split('/')), 'utf8'));
    const chosen = (settings as Record<string, unknown> | null)?.[channel.setting];
    return typeof chosen === 'string' && chosen ? chosen : channel.fallback;
  } catch {
    return channel.fallback;
  }
}

async function readUrl(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  return res.ok ? res.text() : null;
}

function runForOutput(command: string, args: ReadonlyArray<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: SOURCE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Records that an update ran and `latest`, as last read for `key`, stayed out of reach. */
async function rememberNotBrought(cacheFile: string, key: string): Promise<void> {
  const cache = await readLatestCache(cacheFile);
  const known = cache[key];
  if (!known) return;
  await writeFileAtomic(cacheFile, JSON.stringify({ ...cache, [key]: { ...known, notBrought: known.version } })).catch(() => undefined);
}

/**
 * The vendor's newest published version. Answers are kept for an hour in one
 * file under the Moxxy home, so every conversation's runner shares them
 * instead of each asking the registry; when it cannot be reached, the last
 * answer stands.
 */
export async function latestAgentVersion(pkg: string, opts: LatestVersionOptions = {}): Promise<string | null> {
  const cacheFile = opts.cacheFile ?? defaultCacheFile();
  const now = (opts.now ?? Date.now)();
  const cache = await readLatestCache(cacheFile);
  const known = cache[pkg];
  if (known && !opts.refresh && now - known.at < (opts.ttlMs ?? HOUR_MS)) return known.version;
  const fetched = await (opts.fetchLatest ?? ((name: string) => fetchNpmLatest(name)))(pkg);
  if (!fetched) return known ? known.version : null;
  await writeFileAtomic(cacheFile, JSON.stringify({ ...cache, [pkg]: { ...known, version: fetched, at: now } })).catch(() => undefined);
  return fetched;
}

async function readLatestCache(file: string): Promise<LatestCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LatestCache = {};
    for (const [pkg, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const { version, at, notBrought } = (entry ?? {}) as { version?: unknown; at?: unknown; notBrought?: unknown };
      if (typeof version === 'string' && typeof at === 'number') {
        out[pkg] = { version, at, ...(typeof notBrought === 'string' ? { notBrought } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export interface AgentSignIn {
  readonly signedIn: boolean;
  readonly account?: string;
}

export interface AgentCliCheckDeps {
  readonly latest?: (pkg: string, opts: { readonly refresh: boolean }) => Promise<string | null>;
  readonly now?: () => number;
  /** Who the installed agent is signed in as, asked of the agent itself. */
  readonly signIn?: () => Promise<AgentSignIn>;
}

/** Where the CLI stands: missing, too old, behind the vendor's latest, current, or unreadable. */
export async function checkAgentCli(
  desc: AgentCliDescriptor,
  opts: AgentCliSearch & VersionLookup & { readonly refresh?: boolean } = {},
  deps: AgentCliCheckDeps = {},
): Promise<AgentCliReport> {
  const refresh = opts.refresh === true;
  const found = await installedVersion(desc, opts);
  const source = versionSourceOf(desc, found.file, opts);
  const offered = deps.latest
    ? await deps.latest(desc.npmPackage, { refresh })
    : await latestAgentVersion(source.key, { refresh, fetchLatest: source.fetch, ...cacheOption(opts) });
  const notBrought = (await readLatestCache(opts.cacheFile ?? defaultCacheFile()))[source.key]?.notBrought;
  const latest = offered && offered === notBrought ? found.version : offered;
  const origin = found.file ? agentCliOrigin(desc, found.file, originOptions(opts)) : null;
  const plan = found.file && origin ? agentCliUpdatePlan(desc, found.file, origin, opts.platform ?? process.platform) : null;
  const base = {
    command: desc.command,
    installed: found.version,
    ...(found.file && origin ? { path: found.file, origin: origin.origin } : {}),
    ...(plan?.kind === 'manual' ? { manualUpdate: plan.hint } : {}),
    latest,
    minimum: desc.minimumVersion,
    checkedAt: (deps.now ?? Date.now)(),
  };
  if (!found.present) return { state: 'missing', ...base };
  const signIn = deps.signIn ? await deps.signIn() : undefined;
  const known = { ...base, ...(signIn ? { signedIn: signIn.signedIn, account: signIn.account ?? null } : {}) };
  if (!found.version) return { state: 'unknown', ...known };
  if (compareVersions(found.version, desc.minimumVersion) < 0) return { state: 'update-required', ...known };
  if (latest && compareVersions(found.version, latest) < 0) return { state: 'update-available', ...known };
  return { state: 'current', ...known };
}

/** Stand-ins for the shared cache and the network. */
export interface VersionLookup {
  readonly cacheFile?: string;
  readonly fetchImpl?: typeof fetch;
}

/** The file every runner shares its version answers in. */
export function defaultCacheFile(): string {
  return moxxyPath('cache', 'agent-cli-latest.json');
}

function cacheOption(opts: VersionLookup): { readonly cacheFile?: string } {
  return opts.cacheFile ? { cacheFile: opts.cacheFile } : {};
}

function versionSourceOf(desc: AgentCliDescriptor, file: string | undefined, opts: AgentCliSearch & VersionLookup): AgentVersionSource {
  const source: AgentCliSource = file ? agentCliOrigin(desc, file, originOptions(opts)) : { origin: 'unknown' };
  return agentVersionSource(desc, source, {
    ...(opts.home !== undefined ? { home: opts.home } : {}),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

function originOptions(opts: AgentCliSearch): AgentCliOriginOptions {
  return { ...(opts.home !== undefined ? { home: opts.home } : {}), ...(opts.platform !== undefined ? { platform: opts.platform } : {}) };
}

async function installedVersion(
  desc: AgentCliDescriptor,
  opts: AgentCliSearch,
): Promise<{ readonly present: boolean; readonly file?: string; readonly version: string | null }> {
  const file = findAgentCli(desc, opts);
  if (!file) return { present: false, version: null };
  let target: ExecutableTarget;
  try {
    target = agentCliTargetAt(desc, file, { platform: opts.platform ?? process.platform });
  } catch {
    // Found, but in a form Moxxy will not run (e.g. an unknown Windows shim).
    return { present: true, file, version: null };
  }
  return { present: true, file, version: await readCliVersion(target) };
}

export type AgentCliAction = 'install' | 'update';

export interface AgentCliActionOptions extends AgentCliSearch, VersionLookup {
  /** Each line the installer or updater prints, without colour codes. */
  readonly onLine?: (line: string) => void;
  /** How far it got, from a percentage it printed. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  /** How long it may print nothing before it is stopped as stuck. */
  readonly silenceLimitMs?: number;
  /**
   * Folders the host put first on its PATH for itself (the desktop's own
   * Node). An update of a CLI outside them runs with them last: the CLI's
   * updater asks the npm on PATH how it was installed, and the host's npm
   * does not know a CLI that another npm installed.
   */
  readonly hostPathDirs?: ReadonlyArray<string>;
  /** The vendor's latest version of an npm package (default: the registry, cached). */
  readonly latest?: (pkg: string) => Promise<string | null>;
}

/** This process's environment with `hostDirs` moved to the end of PATH, unless `file` lies in one of them. */
export function updaterEnv(
  file: string,
  hostDirs: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Readonly<Record<string, string>> {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const same = (a: string, b: string): boolean => {
    const norm = (p: string) => paths.resolve(p);
    return platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
  };
  const inside = (dir: string): boolean => {
    const relative = paths.relative(dir, file);
    return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative);
  };
  // Windows names the variable `Path`; setting a second `PATH` beside it leaves the child two.
  const key = Object.keys(env).find((name) => (platform === 'win32' ? name.toUpperCase() === 'PATH' : name === 'PATH')) ?? 'PATH';
  const dirs = (env[key] ?? '').split(paths.delimiter).filter(Boolean);
  const own = hostDirs.filter((dir) => !inside(dir));
  const isOwn = (dir: string): boolean => own.some((ownDir) => same(ownDir, dir));
  if (!dirs.some(isOwn)) return {};
  return { [key]: [...dirs.filter((dir) => !isOwn(dir)), ...dirs.filter(isOwn)].join(paths.delimiter) };
}

export interface AgentCliActionResult {
  readonly ok: boolean;
  /** The line that says how it went: the last thing printed, or the error. */
  readonly message: string;
}

/** How the vendor's installer is started: a POSIX shell, or Windows PowerShell by its full path. */
export function installInvocation(
  desc: AgentCliDescriptor,
  platform: NodeJS.Platform = process.platform,
): { readonly command: string; readonly args: ReadonlyArray<string> } {
  if (platform !== 'win32') return { command: '/bin/sh', args: ['-c', desc.install.posix] };
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  return {
    command: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', desc.install.windows],
  };
}

/**
 * Install the CLI with the vendor's installer, or update it with its own
 * command. Resolves when it ends; never rejects.
 */
export async function runAgentCliAction(
  desc: AgentCliDescriptor,
  action: AgentCliAction,
  opts: AgentCliActionOptions = {},
): Promise<AgentCliActionResult> {
  const platform = opts.platform ?? process.platform;
  let child: ChildProcess;
  if (action === 'install') {
    const { command, args } = installInvocation(desc, platform);
    child = spawn(command, [...args], {
      env: { ...process.env, ...desc.installEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: platform !== 'win32',
      windowsHide: true,
    });
  } else {
    const found = findAgentCli(desc, opts);
    if (!found) return { ok: false, message: `${desc.name} is not installed.` };
    const source = agentCliOrigin(desc, found, originOptions(opts));
    if (source.origin === 'app') return { ok: false, message: `The ${desc.name} at ${found} is part of ${source.app ?? 'an app'} and updates with it.` };
    if (source.winget && platform === 'win32') {
      // winget owns this copy, and the agent's own update only prints this command.
      return watch(
        spawn('winget', [...wingetArgs('upgrade', source.winget.id), '--silent', '--accept-package-agreements'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }),
        opts,
      );
    }
    const plan = agentCliUpdatePlan(desc, found, source, platform);
    if (plan.kind === 'manual') return { ok: false, message: `Moxxy cannot update the ${desc.name} at ${found}: ${plan.hint}.` };
    if (plan.kind === 'run') {
      const dirs = (opts.pathEnv ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
      const tool = findExecutable(plan.command, [path.dirname(found), ...dirs], { platform, pathEnv: '' });
      if (!tool) return { ok: false, message: `${plan.command} is not on this computer's PATH.` };
      child = spawn(tool, [...plan.args], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      return watch(child, opts);
    }
    const brew = source.homebrew && platform !== 'win32' ? path.posix.join(source.homebrew.prefix, 'bin', 'brew') : null;
    if (brew && source.homebrew && existsSync(brew)) {
      // Homebrew owns this copy; the agent's own update would put a second one elsewhere.
      child = spawn(brew, ['upgrade', ...(source.homebrew.cask ? ['--cask'] : []), source.homebrew.name], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    } else {
      let target: ExecutableTarget;
      try {
        target = agentCliTargetAt(desc, found, { platform });
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      const before = opts.cacheFile ? await readCliVersion(target) : null;
      child = spawnExecutableTarget(target, await updateArgsFor(desc, target, opts), {
        env: updaterEnv(found, opts.hostPathDirs ?? [], process.env, platform),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: platform !== 'win32',
        windowsHide: true,
      });
      const result = await watch(child, opts);
      if (opts.cacheFile && result.ok && before && before === (await readCliVersion(target))) {
        await rememberNotBrought(opts.cacheFile, versionSourceOf(desc, found, opts).key);
      }
      return result;
    }
  }
  return watch(child, opts);
}

/** The update that reaches the vendor's latest release: the major one when the installed CLI is a major release behind. */
async function updateArgsFor(desc: AgentCliDescriptor, target: ExecutableTarget, opts: AgentCliActionOptions): Promise<ReadonlyArray<string>> {
  if (!desc.majorUpdateArgs) return desc.updateArgs;
  const [installed, latest] = await Promise.all([
    readCliVersion(target),
    (opts.latest ?? ((pkg: string) => latestAgentVersion(pkg)))(desc.npmPackage).catch(() => null),
  ]);
  // A version below the minimum may not know the major flag; the plain update brings it up first.
  const canMove = installed && compareVersions(installed, desc.minimumVersion) >= 0;
  return canMove && latest && majorOf(installed) < majorOf(latest) ? desc.majorUpdateArgs : desc.updateArgs;
}

function majorOf(version: string): number {
  return Number.parseInt(version, 10);
}

/** How long an updater may stay silent before it counts as stuck; a slow download still prints. */
const SILENCE_LIMIT_MS = 10 * 60_000;
/** A yes-or-no question from an updater; nobody can answer it, so it would wait forever. */
const ASKS_TO_CONFIRM = /\b(?:install anyways|continue anyway|proceed)\?|\(y\/n\)|\[y\/n\]/i;

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const PERCENT = /(\d{1,3}(?:\.\d+)?)%/;

/** The line that asks, without the frame a prompt draws around it; its choices come after it. */
function askedQuestion(text: string): string {
  const line = text.split(/\r\n|\r|\n/).find((candidate) => ASKS_TO_CONFIRM.test(candidate)) ?? '';
  return line.replace(/^[^\p{L}\p{N}(]+/u, '').trim();
}

function watch(child: ChildProcess, opts: AgentCliActionOptions): Promise<AgentCliActionResult> {
  const limitMs = opts.silenceLimitMs ?? SILENCE_LIMIT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const last = { stdout: '', stderr: '' };
    const finish = (result: AgentCliActionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(silence);
      opts.signal?.removeEventListener('abort', stop);
      resolve(result);
    };
    const end = (message: string): void => {
      killTree(child, 'SIGTERM');
      finish({ ok: false, message });
    };
    const stop = (): void => end('Stopped.');
    let silence: NodeJS.Timeout | undefined;
    const heard = (): void => {
      clearTimeout(silence);
      silence = setTimeout(() => end(`Stopped: nothing printed for ${Math.round(limitMs / 60_000)} minutes.`), limitMs);
      silence.unref();
    };
    heard();
    if (opts.signal?.aborted) {
      stop();
      return;
    }
    opts.signal?.addEventListener('abort', stop, { once: true });
    const take = (stream: keyof typeof last, part: string): void => {
      const line = part.replace(ANSI, '').trim();
      if (!line || settled) return;
      last[stream] = line;
      const percent = PERCENT.exec(line);
      if (percent) opts.onProgress?.(Math.min(Number(percent[1]), 100) / 100);
      opts.onLine?.(line);
    };
    for (const stream of ['stdout', 'stderr'] as const) {
      let pending = '';
      child[stream]?.on('data', (chunk: Buffer) => {
        heard();
        const text = (pending + chunk.toString('utf8')).replace(ANSI, '');
        if (ASKS_TO_CONFIRM.test(text)) {
          end(`It asked to confirm, and Moxxy cannot answer: "${askedQuestion(text)}" Run the update in a terminal.`);
          return;
        }
        const parts = (pending + chunk.toString('utf8')).split(/\r\n|\r|\n/);
        pending = parts.pop() ?? '';
        for (const part of parts) take(stream, part);
      });
      child[stream]?.on('end', () => take(stream, pending));
    }
    child.once('error', (err) => finish({ ok: false, message: err.message }));
    child.once('close', (code) => {
      if (code === 0) finish({ ok: true, message: last.stdout || last.stderr || 'Done.' });
      else finish({ ok: false, message: last.stderr || last.stdout || `It ended with exit code ${String(code)}.` });
    });
  });
}
