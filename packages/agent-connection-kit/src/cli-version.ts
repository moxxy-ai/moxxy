import { realpathSync } from 'node:fs';
import {
  resolveExecutableTarget,
  spawnExecutableTarget,
  type ExecutableSearchOptions,
  type ExecutableTarget,
} from '@moxxy/sdk/server';

/** How to find and update one vendor agent CLI. */
export interface AgentCliSpec {
  readonly command: string;
  /** Path pieces (with `/`) that mark the vendor's own installer, e.g. `.local/share/claude`. */
  readonly nativeDirs?: ReadonlyArray<string>;
  /** Arguments to `npm`, to `brew`, and to the CLI itself, that update it. */
  readonly update: {
    readonly npm?: ReadonlyArray<string>;
    readonly brew?: ReadonlyArray<string>;
    readonly native?: ReadonlyArray<string>;
  };
}

export type CliInstaller = 'npm' | 'brew' | 'native' | 'unknown';

export interface UpdateCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface AgentCliInfo {
  readonly path: string;
  /** `null` when the CLI printed no version. */
  readonly version: string | null;
  readonly installer: CliInstaller;
  /** `null` when Moxxy cannot tell how to update it safely. */
  readonly update: UpdateCommand | null;
}

export interface InspectOptions extends ExecutableSearchOptions {
  readonly timeoutMs?: number;
}

const VERSION = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
const DEFAULT_TIMEOUT_MS = 10_000;

/** The installed CLI, or `null` when it is not on PATH. */
export async function inspectAgentCli(spec: AgentCliSpec, opts: InspectOptions = {}): Promise<AgentCliInfo | null> {
  const target = resolveExecutableTarget(spec.command, opts);
  if (!target) return null;
  const installer = detectInstaller(installedFile(target), spec);
  // A Windows npm shim runs a Node entry; a native install is always run directly.
  const cliPath = target.kind === 'node' ? target.entry : target.command;
  return {
    path: cliPath,
    version: parseVersion(await printedVersion(target, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    installer,
    update: updateCommandFor(installer, spec, cliPath),
  };
}

export function detectInstaller(file: string, spec: AgentCliSpec): CliInstaller {
  const p = file.replace(/\\/g, '/');
  if (p.includes('/node_modules/')) return 'npm';
  if (/\/(Cellar|Caskroom|homebrew|\.?linuxbrew)\//i.test(p)) return 'brew';
  if (spec.nativeDirs?.some((dir) => p.includes(`/${dir}/`))) return 'native';
  return 'unknown';
}

export function updateCommandFor(installer: CliInstaller, spec: AgentCliSpec, cliPath: string): UpdateCommand | null {
  switch (installer) {
    case 'npm':
      return spec.update.npm ? { command: 'npm', args: spec.update.npm } : null;
    case 'brew':
      return spec.update.brew ? { command: 'brew', args: spec.update.brew } : null;
    case 'native':
      return spec.update.native ? { command: cliPath, args: spec.update.native } : null;
    case 'unknown':
      return null;
  }
}

export function parseVersion(text: string): string | null {
  return VERSION.exec(text)?.[0] ?? null;
}

/** Negative when `a` is older than `b`; a pre-release comes before its release. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = splitPre(a);
  const [coreB = '', preB] = splitPre(b);
  const numsA = coreA.split('.').map(Number);
  const numsB = coreB.split('.').map(Number);
  for (let i = 0; i < Math.max(numsA.length, numsB.length); i += 1) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (preA === undefined) return 1;
  if (preB === undefined) return -1;
  return preA.localeCompare(preB, 'en', { numeric: true });
}

function splitPre(version: string): [string, string | undefined] {
  const at = version.indexOf('-');
  return at === -1 ? [version, undefined] : [version.slice(0, at), version.slice(at + 1)];
}

/** The file the installer put there: through the PATH link, or the Node entry of a Windows shim. */
function installedFile(target: ExecutableTarget): string {
  const file = target.kind === 'node' ? target.entry : target.command;
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

function printedVersion(target: ExecutableTarget, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawnExecutableTarget(target, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}
