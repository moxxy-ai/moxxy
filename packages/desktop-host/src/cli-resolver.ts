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

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
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

/**
 * The `dist/bin.js` path the desktop should run, preferring a writable,
 * user-updated copy under `<userDataDir>/cli` over the read-only one
 * bundled in resources. Mirrors the preference order the Electron main's
 * boot block applies to `MOXXY_CLI_ENTRY`, factored out so the in-app
 * "Update CLI" action can re-point at the freshly-installed copy without
 * duplicating the path logic. Returns null when neither exists.
 */
export function preferredCliEntry(userDataDir: string, resourcesPath: string): string | null {
  const updatedCli = path.join(
    userDataDir,
    'cli',
    'node_modules',
    '@moxxy',
    'cli',
    'dist',
    'bin.js',
  );
  const bundledCli = path.join(resourcesPath, 'moxxy-cli', 'dist', 'bin.js');
  return [updatedCli, bundledCli].find((p) => existsSync(p)) ?? null;
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
 * Directories where a working `moxxy` / `node` / `npm` commonly lives that
 * are not always on a GUI-launch PATH. The supervisor + onboarding probe pass
 * these as `extraPaths` so a user with moxxy in nvm + a desktop launched from
 * Finder still resolves it — and, critically on Windows, so a Node installed
 * AFTER the desktop launched is found on the next "re-check" even though the
 * running process's PATH never picked up the installer's SYSTEM-PATH edit.
 */
export function augmentedPaths(platform: NodeJS.Platform = process.platform): string[] {
  const out: string[] = [];
  if (platform === 'darwin') {
    out.push('/usr/local/bin', '/opt/homebrew/bin');
  } else if (platform === 'win32') {
    // The official Node installer drops node.exe / npm.cmd in <ProgramFiles>\nodejs
    // and edits the SYSTEM PATH — which a process started before the install
    // never sees. Consult the standard install dirs directly so the onboarding
    // "Install Node → re-check" loop clears without an app restart.
    for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
      const base = process.env[key];
      if (base) out.push(path.join(base, 'nodejs'));
    }
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) out.push(path.join(localAppData, 'Programs', 'nodejs'));
    // nvm-windows keeps the active version behind this "current" symlink.
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) out.push(nvmSymlink);
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

/**
 * How to launch a Node script from the desktop. In a packaged Electron app
 * there is no system `node`, but the Electron binary runs as Node when
 * ELECTRON_RUN_AS_NODE=1 — use that so the bundled CLI runs with zero external
 * dependencies. Falls back to `node` (dev / tests / non-Electron).
 */
export function nodeLauncher(): { command: string; env: NodeJS.ProcessEnv } {
  if (process.versions.electron) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: 'node', env: {} };
}

/**
 * Spawn the resolved moxxy CLI with `args`, hiding the
 * direct-bin-vs-Electron-Node branch and the GUI-launch PATH dance that every
 * caller otherwise hand-rolls. `opts.env` is merged onto `process.env`, then
 * PATH is forced to the spawn PATH (caller env can't clobber it) so moxxy's
 * `#!/usr/bin/env node` shebang resolves even on a Finder/Dock launch. `stdio`
 * defaults to ignore-stdin / piped stdout+stderr. The returned child is
 * unhandled — callers attach their own stdout/stderr/stdin/exit wiring.
 */
export function spawnCli(
  cli: CliInvocation,
  args: ReadonlyArray<string>,
  opts: { env?: NodeJS.ProcessEnv; stdio?: SpawnOptions['stdio']; cwd?: string } = {},
): ChildProcess {
  const cliDir = cli.kind === 'direct' ? path.dirname(cli.bin) : path.dirname(cli.entry);
  const env = { ...process.env, ...opts.env, PATH: spawnPath([cliDir]) };
  const spawnOpts: SpawnOptions = { env, stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'] };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;
  if (cli.kind === 'direct') {
    return spawn(cli.bin, [...args], spawnOpts);
  }
  // No system `node` on a GUI launch — run the bundled CLI with Electron's own
  // Node (ELECTRON_RUN_AS_NODE), merged onto the PATH env above.
  const { command, env: nodeEnv } = nodeLauncher();
  return spawn(command, [cli.entry, ...args], { ...spawnOpts, env: { ...env, ...nodeEnv } });
}

function isReadableFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Filenames to try for executable `name` on `platform`. On Windows an
 * executable carries an extension (`node.exe`, `npm.cmd`), so a bare `node`
 * NEVER resolves — expand to the PATHEXT variants. Elsewhere the bare name IS
 * the executable. If `name` already has an extension it's used verbatim.
 */
export function executableCandidates(
  name: string,
  platform: NodeJS.Platform = process.platform,
  pathext: string | undefined = process.env.PATHEXT,
): string[] {
  if (platform !== 'win32' || path.extname(name)) return [name];
  const exts = (pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`).toLowerCase());
  // Bare name first (a few tools ship extensionless), then the PATHEXT variants.
  return [name, ...exts.map((e) => name + e)];
}

/**
 * First `name` found in PATH (plus `extra` dirs), or null. Used both to resolve
 * `moxxy` and — by the installer/onboarding probe — to locate `node`/`npm` on a
 * GUI-launch PATH. Tries the platform's executable extensions (Windows).
 */
export function findExecutable(name: string, extra: ReadonlyArray<string>): string | null {
  const pathEnv = process.env.PATH ?? '';
  const dirs = pathEnv.split(delimiter).concat(extra).filter(Boolean);
  const candidates = executableCandidates(name);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isReadableFile(full)) return full;
    }
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
