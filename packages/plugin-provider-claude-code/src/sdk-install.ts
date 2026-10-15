import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { moxxyPath, resolveExecutableTarget, spawnExecutableTarget } from '@moxxy/sdk/server';
import type { ClaudeAgentSdk } from './sdk-types.js';

/**
 * The Claude Agent SDK is installed with the person's npm into a folder under
 * `~/.moxxy`, one sub-folder per version, and loaded from there at runtime:
 * it needs zod 4 and the MCP SDK, which stay out of Moxxy's bundle. The CLI it
 * would bring along is skipped (`--omit=optional`); Moxxy runs the person's own.
 */

export const CLAUDE_AGENT_SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';
export const CLAUDE_AGENT_SDK_VERSION = '0.3.296';

export interface SdkInstallOptions {
  /** Where versions are installed; defaults to `~/.moxxy/agents/claude-agent-sdk`. */
  readonly home?: string;
  readonly version?: string;
  /** PATH to find npm on (tests). */
  readonly pathEnv?: string;
}

const MAX_NPM_OUTPUT = 4096;
const loaded = new Map<string, Promise<ClaudeAgentSdk>>();

export function claudeAgentSdkHome(): string {
  return moxxyPath('agents', 'claude-agent-sdk');
}

/** The SDK, installing it first when this version is not there yet. */
export function ensureClaudeAgentSdk(opts: SdkInstallOptions = {}): Promise<ClaudeAgentSdk> {
  const dir = versionDir(opts);
  const cached = loaded.get(dir);
  if (cached) return cached;
  const loading = (async () => {
    if (!existsSync(dir)) await installClaudeAgentSdk(opts);
    return loadClaudeAgentSdk(dir);
  })();
  loaded.set(dir, loading);
  loading.catch(() => loaded.delete(dir));
  return loading;
}

/** The SDK when this version is installed already; `undefined`, installing nothing, when it is not. */
export async function installedClaudeAgentSdk(opts: SdkInstallOptions = {}): Promise<ClaudeAgentSdk | undefined> {
  if (!existsSync(versionDir(opts))) return undefined;
  return ensureClaudeAgentSdk(opts);
}

/** Install into a scratch folder and move it in place only once npm succeeded. */
export async function installClaudeAgentSdk(opts: SdkInstallOptions = {}): Promise<void> {
  const version = opts.version ?? CLAUDE_AGENT_SDK_VERSION;
  const dir = versionDir(opts);
  const npm = resolveExecutableTarget('npm', opts.pathEnv === undefined ? {} : { pathEnv: opts.pathEnv });
  if (!npm) throw new Error('Installing the Claude Agent SDK needs npm (it comes with Node.js), and none was found on PATH.');

  const partial = `${dir}.partial-${process.pid}-${Date.now()}`;
  await mkdir(partial, { recursive: true });
  try {
    await writeFile(
      path.join(partial, 'package.json'),
      `${JSON.stringify({ name: 'moxxy-claude-agent-sdk', private: true, dependencies: { [CLAUDE_AGENT_SDK_PACKAGE]: version } }, null, 2)}\n`,
    );
    await runNpm(npm, partial, ['install', '--omit=optional', '--no-audit', '--no-fund', '--loglevel=error']);
    await rename(partial, dir);
  } catch (err) {
    await rm(partial, { recursive: true, force: true, maxRetries: 3 });
    throw err;
  }
}

export async function loadClaudeAgentSdk(dir: string): Promise<ClaudeAgentSdk> {
  const pkgDir = path.join(dir, 'node_modules', ...CLAUDE_AGENT_SDK_PACKAGE.split('/'));
  let manifest: { main?: string; exports?: { '.'?: { default?: string; import?: string } } };
  try {
    manifest = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    throw new Error(`The Claude Agent SDK is not installed in ${dir}.`);
  }
  const root = manifest.exports?.['.'];
  const entry = root?.import ?? root?.default ?? manifest.main ?? 'sdk.mjs';
  const mod = (await import(pathToFileURL(path.join(pkgDir, entry)).href)) as Partial<ClaudeAgentSdk>;
  if (typeof mod.query !== 'function') throw new Error(`The Claude Agent SDK in ${dir} has no query().`);
  return mod as ClaudeAgentSdk;
}

function versionDir(opts: SdkInstallOptions): string {
  return path.join(opts.home ?? claudeAgentSdkHome(), opts.version ?? CLAUDE_AGENT_SDK_VERSION);
}

function runNpm(npm: NonNullable<ReturnType<typeof resolveExecutableTarget>>, cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnExecutableTarget(npm, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_NPM_OUTPUT);
    });
    child.once('error', (err) => reject(new Error(`Could not run npm: ${err.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm could not install the Claude Agent SDK (exit ${code ?? 'signal'}): ${stderr.trim()}`));
    });
  });
}
