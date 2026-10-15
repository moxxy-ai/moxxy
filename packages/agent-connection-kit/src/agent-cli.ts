import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentCliReport } from '@moxxy/sdk';
import {
  fetchNpmLatest,
  findExecutable,
  killTree,
  moxxyPath,
  resolveExecutableTarget,
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
  /** The npm package whose `latest` tag is the vendor's newest release. */
  readonly npmPackage: string;
  /** The oldest version Moxxy was checked against; older ones must be updated first. */
  readonly minimumVersion: string;
  /** Arguments to the CLI itself that update it, however it was installed. */
  readonly updateArgs: ReadonlyArray<string>;
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
}

export const CLAUDE_CLI: AgentCliDescriptor = {
  name: 'Claude Code',
  command: 'claude',
  npmPackage: '@anthropic-ai/claude-code',
  minimumVersion: '2.1.296',
  updateArgs: ['update'],
  install: { posix: 'curl -fsSL https://claude.ai/install.sh | bash', windows: 'irm https://claude.ai/install.ps1 | iex' },
  installDirs: ['.local/bin'],
};

export const CODEX_CLI: AgentCliDescriptor = {
  name: 'Codex',
  command: 'codex',
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
};

export const OPENCODE_CLI: AgentCliDescriptor = {
  name: 'OpenCode',
  command: 'opencode',
  npmPackage: 'opencode-ai',
  minimumVersion: '1.19.0',
  updateArgs: ['upgrade'],
  // OpenCode's install script is POSIX only; on Windows it ships through npm.
  install: { posix: 'curl -fsSL https://opencode.ai/install | bash', windows: 'npm install -g opencode-ai' },
  installDirs: ['.opencode/bin'],
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
}

function searchOptions(desc: AgentCliDescriptor, opts: AgentCliSearch) {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? homedir();
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return {
    command: opts.command ?? desc.command,
    platform,
    extraPaths: desc.installDirs.map((dir) => paths.join(home, ...dir.split('/'))),
    ...(opts.pathEnv !== undefined ? { pathEnv: opts.pathEnv } : {}),
  };
}

/** The CLI's file: on PATH first, as a terminal would run it, then where the vendor's installer puts it. */
export function findAgentCli(desc: AgentCliDescriptor, opts: AgentCliSearch = {}): string | null {
  const { command, extraPaths, ...search } = searchOptions(desc, opts);
  return findExecutable(command, extraPaths, search);
}

function agentCliTarget(desc: AgentCliDescriptor, opts: AgentCliSearch): ExecutableTarget | null {
  const { command, ...search } = searchOptions(desc, opts);
  return resolveExecutableTarget(command, search);
}

export interface LatestVersionOptions {
  readonly refresh?: boolean;
  readonly cacheFile?: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly fetchLatest?: (pkg: string) => Promise<string | null>;
}

const HOUR_MS = 60 * 60_000;

type LatestCache = Record<string, { readonly version: string; readonly at: number }>;

/**
 * The vendor's newest published version. Answers are kept for an hour in one
 * file under the Moxxy home, so every conversation's runner shares them
 * instead of each asking the registry; when it cannot be reached, the last
 * answer stands.
 */
export async function latestAgentVersion(pkg: string, opts: LatestVersionOptions = {}): Promise<string | null> {
  const cacheFile = opts.cacheFile ?? moxxyPath('cache', 'agent-cli-latest.json');
  const now = (opts.now ?? Date.now)();
  const cache = await readLatestCache(cacheFile);
  const known = cache[pkg];
  if (known && !opts.refresh && now - known.at < (opts.ttlMs ?? HOUR_MS)) return known.version;
  const fetched = await (opts.fetchLatest ?? ((name: string) => fetchNpmLatest(name)))(pkg);
  if (!fetched) return known ? known.version : null;
  await writeFileAtomic(cacheFile, JSON.stringify({ ...cache, [pkg]: { version: fetched, at: now } })).catch(() => undefined);
  return fetched;
}

async function readLatestCache(file: string): Promise<LatestCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: LatestCache = {};
    for (const [pkg, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const { version, at } = (entry ?? {}) as { version?: unknown; at?: unknown };
      if (typeof version === 'string' && typeof at === 'number') out[pkg] = { version, at };
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
  opts: AgentCliSearch & { readonly refresh?: boolean } = {},
  deps: AgentCliCheckDeps = {},
): Promise<AgentCliReport> {
  const refresh = opts.refresh === true;
  const [found, latest] = await Promise.all([
    installedVersion(desc, opts),
    (deps.latest ?? ((pkg, o) => latestAgentVersion(pkg, o)))(desc.npmPackage, { refresh }),
  ]);
  const base = { command: desc.command, installed: found.version, latest, minimum: desc.minimumVersion, checkedAt: (deps.now ?? Date.now)() };
  if (!found.present) return { state: 'missing', ...base };
  const signIn = deps.signIn ? await deps.signIn() : undefined;
  const known = { ...base, ...(signIn ? { signedIn: signIn.signedIn, account: signIn.account ?? null } : {}) };
  if (!found.version) return { state: 'unknown', ...known };
  if (compareVersions(found.version, desc.minimumVersion) < 0) return { state: 'update-required', ...known };
  if (latest && compareVersions(found.version, latest) < 0) return { state: 'update-available', ...known };
  return { state: 'current', ...known };
}

async function installedVersion(
  desc: AgentCliDescriptor,
  opts: AgentCliSearch,
): Promise<{ readonly present: boolean; readonly version: string | null }> {
  let target: ExecutableTarget | null;
  try {
    target = agentCliTarget(desc, opts);
  } catch {
    // Found, but in a form Moxxy will not run (e.g. an unknown Windows shim).
    return { present: true, version: null };
  }
  return target ? { present: true, version: await readCliVersion(target) } : { present: false, version: null };
}

export type AgentCliAction = 'install' | 'update';

export interface AgentCliActionOptions extends AgentCliSearch {
  /** Each line the installer or updater prints, without colour codes. */
  readonly onLine?: (line: string) => void;
  /** How far it got, from a percentage it printed. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
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
    let target: ExecutableTarget | null;
    try {
      target = agentCliTarget(desc, opts);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (!target) return { ok: false, message: `${desc.name} is not installed.` };
    child = spawnExecutableTarget(target, desc.updateArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: platform !== 'win32',
      windowsHide: true,
    });
  }
  return watch(child, opts);
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const PERCENT = /(\d{1,3}(?:\.\d+)?)%/;

function watch(child: ChildProcess, opts: AgentCliActionOptions): Promise<AgentCliActionResult> {
  return new Promise((resolve) => {
    let settled = false;
    const last = { stdout: '', stderr: '' };
    const finish = (result: AgentCliActionResult): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', stop);
      resolve(result);
    };
    const stop = (): void => {
      killTree(child, 'SIGTERM');
      finish({ ok: false, message: 'Stopped.' });
    };
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
