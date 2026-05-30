/**
 * Find a working moxxy CLI invocation.
 *
 * Strategy, in order:
 *   1. `MOXXY_CLI_ENTRY` env var pointing at a bin.js — invoked as
 *      `node <path>`.
 *   2. `moxxy` on PATH — typically the npm-installed global. The npm
 *      shim is a Node shebang that resolves its own deps.
 *   3. Monorepo dev tree (`packages/cli/dist/bin.js`) — invoked as
 *      `node <path>`.
 *
 * macOS Finder launches strip PATH of nvm/homebrew dirs. The
 * supervisor opts into [`augmentedPaths()`] when running for real;
 * tests skip it so PATH isolation actually isolates.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { delimiter } from 'node:path';

export type CliInvocation =
  | { kind: 'direct'; bin: string }
  | { kind: 'node'; entry: string };

export interface ResolveOptions {
  /** Extra directories to consult in addition to PATH. The main
   *  process passes the macOS GUI-launch fallbacks; tests pass none. */
  readonly extraPaths?: ReadonlyArray<string>;
}

export function resolveMoxxyCli(opts: ResolveOptions = {}): CliInvocation | null {
  const envEntry = process.env.MOXXY_CLI_ENTRY;
  if (envEntry && isReadableFile(envEntry)) {
    return { kind: 'node', entry: envEntry };
  }

  const onPath = findExecutable('moxxy', opts.extraPaths ?? []);
  if (onPath) return { kind: 'direct', bin: onPath };

  const monorepo = walkUpForMonorepoCli();
  if (monorepo) return { kind: 'node', entry: monorepo };

  return null;
}

/**
 * Directories where a working `moxxy` install commonly lives that
 * are not always on a GUI-launch PATH. The supervisor passes these
 * as `extraPaths` so a user with moxxy in nvm + a desktop launched
 * from Finder still resolves it.
 */
export function augmentedPaths(): string[] {
  const out: string[] = [];
  if (process.platform === 'darwin') {
    out.push('/usr/local/bin', '/opt/homebrew/bin');
  }
  const home = process.env.HOME;
  if (home) {
    const nvmVersions = path.join(home, '.nvm', 'versions', 'node');
    if (existsSync(nvmVersions)) {
      try {
        for (const v of readdirSync(nvmVersions)) {
          out.push(path.join(nvmVersions, v, 'bin'));
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/**
 * Build the PATH to use when SPAWNING the moxxy CLI / npm from the desktop.
 *
 * macOS Finder/Dock launches don't inherit the shell PATH, so `node` — which
 * moxxy's (and npm's) `#!/usr/bin/env node` shebang needs, and which lives in
 * the SAME bin dir as the resolved `moxxy`/`npm` (nvm, homebrew, global npm) —
 * isn't found by the child. Without this, `moxxy serve` exits 127 and
 * `moxxy login <provider>` dies with "env: node: No such file or directory".
 *
 * Prepend the caller-supplied dirs (typically the resolved binary's own
 * directory) plus the known install locations, then the inherited PATH.
 */
export function spawnPath(extraDirs: ReadonlyArray<string> = []): string {
  const dirs = [
    ...extraDirs,
    ...augmentedPaths(),
    ...(process.env.PATH ?? '').split(delimiter),
  ].filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}

function isReadableFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function findExecutable(name: string, extra: ReadonlyArray<string>): string | null {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(delimiter).concat(extra).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (isReadableFile(candidate)) return candidate;
  }
  return null;
}

function walkUpForMonorepoCli(): string | null {
  let cur = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(cur, 'packages', 'cli', 'dist', 'bin.js');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
