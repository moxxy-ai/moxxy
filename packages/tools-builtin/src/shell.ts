import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { findExecutable } from '@moxxy/sdk/server';
import { dropDanglingSurrogate } from './util.js';

/** How long after SIGTERM before the whole process group gets SIGKILL. */
export const SIGKILL_GRACE_MS = 2_000;

/**
 * Env vars that look like credentials. The inproc isolator can't enforce the
 * declared env allow-list, so the spawned shell would otherwise inherit every
 * secret the runner holds in `process.env` (API keys, vault material, CI
 * tokens) — a `printenv` then exfiltrates them. Scrub anything that looks like
 * a secret before spawning. The model can still set a needed var explicitly via
 * the `env` input (overlaid after scrubbing), so usability is preserved.
 */
const SECRET_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|MOXXY_VAULT)/i;

export function scrubbedEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Signal the child's whole process group, not just the shell. The shell is
 * spawned `detached` on POSIX so it leads its own group; a negative-pid kill
 * then reaches every descendant (`sh -c 'sleep 1000 & wait'`, build workers,
 * …) instead of orphaning them.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // Windows has no process groups; taskkill /T walks the tree down from the
    // shell. Always forced: a console program has no SIGTERM handler to run.
    if (child.exitCode !== null || child.signalCode !== null) return;
    const taskkill = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {
      child.kill(signal);
    });
    return;
  }
  try {
    // Deliberately *no* "child already exited" guard here: the group outlives
    // its leader (SIGTERM may kill the shell while a TERM-ignoring descendant
    // lives on), and the pgid stays valid — and un-reusable — while any
    // member survives. ESRCH below covers the fully-gone case.
    process.kill(-child.pid, signal);
  } catch (e) {
    // ESRCH: the group is already gone — nothing to do. Anything else
    // (e.g. EPERM, or the child somehow not leading a group): fall back to
    // signalling the shell itself so we at least keep the old behavior.
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }
  }
}

/**
 * Bounded output accumulator: retains up to `cap` chars and counts (drains)
 * the rest, so total truncated size can still be reported accurately.
 *
 * Decodes through a `StringDecoder` so a multibyte UTF-8 sequence (emoji, CJK,
 * accented chars) split across two `data` chunks at an arbitrary byte boundary
 * is held back and joined, rather than each fragment decoding to U+FFFD. Call
 * `end()` once the stream closes to flush any trailing partial bytes.
 */
export function boundedSink(cap: number): {
  push: (b: Buffer) => void;
  end: () => void;
  readonly text: string;
  readonly dropped: number;
} {
  const decoder = new StringDecoder('utf8');
  let text = '';
  let dropped = 0;
  const absorb = (s: string): void => {
    if (s.length === 0) return;
    const room = cap - text.length;
    if (room >= s.length) {
      text += s;
    } else {
      if (room > 0) text += dropDanglingSurrogate(s.slice(0, room));
      dropped += s.length - Math.max(room, 0);
    }
  };
  return {
    push(b: Buffer): void {
      absorb(decoder.write(b));
    },
    end(): void {
      absorb(decoder.end());
    },
    get text() {
      return text;
    },
    get dropped() {
      return dropped;
    },
  };
}

/**
 * `/bin/sh -l` reads the system profile, which on macOS rebuilds PATH with the
 * system folders in front. The folders the host names in `MOXXY_PATH_FIRST`
 * (the desktop's bundled Python) are put back ahead of them, so `python3` is
 * the bundled one and not the system's install prompt.
 */
export function withPathFirst(command: string, first: string | undefined): string {
  if (!first) return command;
  return `export PATH='${first.replace(/'/g, `'\\''`)}':"$PATH"\n${command}`;
}

/** `C:\a\b;D:\c` as Git Bash spells a PATH list: `/c/a/b:/d/c`. */
export function msysPathList(dirs: string): string {
  return dirs
    .split(';')
    .filter((dir) => dir !== '')
    .map((dir) => dir.replace(/^([A-Za-z]):/u, (_, drive: string) => `/${drive.toLowerCase()}`).replace(/\\/gu, '/'))
    .join(':');
}

/** The shell the Bash tool runs a command in. */
export interface Shell {
  /** `sh` off Windows; on Windows Git Bash, or Windows PowerShell where Git is not installed. */
  readonly kind: 'sh' | 'git-bash' | 'powershell';
  readonly file: string;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Windows reads PATH under any spelling (`Path` is the usual one); a copy of the env keeps the one it had. */
function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
}

/**
 * The bash of Git for Windows: `MOXXY_GIT_BASH`, else the one beside the Git
 * on PATH, else the installer's folders. A bash.exe found on PATH alone is
 * never taken: `C:\Windows\System32\bash.exe` starts WSL, a Linux machine with
 * its own files and paths.
 */
export function findGitBash(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates: string[] = [];
  if (env.MOXXY_GIT_BASH) candidates.push(env.MOXXY_GIT_BASH);
  const git = findExecutable('git', [], { platform: 'win32', pathEnv: env[pathKey(env)] ?? '' });
  if (git !== null) {
    // <Git>\cmd\git.exe, <Git>\bin\git.exe or <Git>\mingw64\bin\git.exe.
    const dir = path.dirname(git);
    candidates.push(path.join(dir, '..', 'bin', 'bash.exe'), path.join(dir, '..', '..', 'bin', 'bash.exe'));
  }
  const local = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : undefined;
  for (const base of [env.ProgramFiles, env.ProgramW6432, local]) {
    if (base) candidates.push(path.join(base, 'Git', 'bin', 'bash.exe'));
  }
  return candidates.find(isFile) ?? null;
}

export function shellFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Shell {
  if (platform !== 'win32') return { kind: 'sh', file: '/bin/sh' };
  const bash = findGitBash(env);
  if (bash !== null) return { kind: 'git-bash', file: bash };
  const root = env.SystemRoot ?? 'C:\\Windows';
  return { kind: 'powershell', file: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') };
}

let current: Shell | undefined;

/** This machine's shell, looked up once: a Git installed later is seen after a restart. */
export function systemShell(): Shell {
  current ??= shellFor(process.platform, process.env);
  return current;
}

/**
 * Runs the command held in MOXXY_COMMAND, so its quotes never cross the
 * Windows command line, where Windows PowerShell drops them. Prints UTF-8 and
 * exits like sh: with the last program's exit code, or 1 when the last command
 * failed. (-EncodedCommand would carry it too, but writes errors as CLIXML.)
 *
 * Its own cmdlet modules are loaded from $PSHOME first: otherwise the first
 * Remove-Item or Write-Output is looked up through every module on PSModulePath
 * before them, which takes seconds on a machine with many modules and lets one
 * that exports the same name take the cmdlet over.
 */
const POWERSHELL_LAUNCHER = [
  "Import-Module ($PSHOME + '\\Modules\\Microsoft.PowerShell.Management'), ($PSHOME + '\\Modules\\Microsoft.PowerShell.Utility')",
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  "$ProgressPreference = 'SilentlyContinue'",
  '$moxxyCommand = $env:MOXXY_COMMAND',
  'Remove-Item Env:MOXXY_COMMAND',
  '$global:LASTEXITCODE = 0',
  '$global:MoxxyOk = $true',
  ". ([scriptblock]::Create($moxxyCommand + [Environment]::NewLine + '$global:MoxxyOk = $?'))",
  'if ($LASTEXITCODE) { exit $LASTEXITCODE }',
  'if (-not $global:MoxxyOk) { exit 1 }',
].join('; ');

/** The arguments that run `command` in `shell`; may add to `env`. */
function shellArgs(shell: Shell, command: string, env: NodeJS.ProcessEnv): string[] {
  const first = env.MOXXY_PATH_FIRST;
  switch (shell.kind) {
    case 'sh':
      return ['-lc', withPathFirst(command, first)];
    case 'git-bash':
      // Git's bash puts its own folders ahead of PATH, as a login shell does on macOS.
      return ['-c', withPathFirst(command, first ? msysPathList(first) : undefined)];
    case 'powershell': {
      if (first) {
        const key = pathKey(env);
        env[key] = env[key] ? `${first};${env[key]}` : first;
      }
      env.MOXXY_COMMAND = command;
      return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_LAUNCHER];
    }
  }
}

/**
 * Spawn `command` in this machine's shell ({@link systemShell}) with a
 * secret-scrubbed env (model-supplied `env` overlaid) and piped output. POSIX
 * children lead their own process group so {@link killTree} reaches every
 * descendant.
 */
export function spawnShell(
  command: string,
  opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>>; readonly shell?: Shell },
): ChildProcess & { stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> } {
  const env = { ...scrubbedEnv(process.env), ...(opts.env ?? {}) };
  const shell = opts.shell ?? systemShell();
  return spawn(shell.file, shellArgs(shell, command, env), {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `detached` only detaches the controlling terminal/group — piped stdio
    // and exit reporting are unaffected. Not meaningful on win32.
    detached: process.platform !== 'win32',
    // Without it every command flashes a console window from the desktop app.
    windowsHide: true,
  });
}
