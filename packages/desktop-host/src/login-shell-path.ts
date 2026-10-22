import { execFile, spawn } from 'node:child_process';
import { userInfo } from 'node:os';

/**
 * An app started from Finder, the Dock or a Linux menu gets a short system
 * PATH, not the one the person's terminal builds in its profile. Programs were
 * then found in another order than the terminal finds them: an old Homebrew
 * `claude` won over the current one in `~/.local/bin`, and one installed
 * where only the profile points (pnpm, bun, mise) was not found at all.
 */

const MARK = '__MOXXY_LOGIN_SHELL_PATH__';
const DEFAULT_TIMEOUT_MS = 5_000;
const LAUNCHCTL_TIMEOUT_MS = 2_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LoginShellPathOptions {
  readonly platform?: NodeJS.Platform;
  /** Whose shell and home; `SHELL` names the shell. */
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** The account's own login shell, asked when `SHELL` fails; defaults to the system's record of it. */
  readonly userShell?: string | undefined;
  /** Asked last: `/bin/zsh` on macOS, `/bin/bash` on Linux. */
  readonly fallbackShell?: string | undefined;
  /** The PATH launchd gives the person's apps on macOS, when no shell gives one. */
  readonly launchctl?: () => Promise<string | null>;
  /** One line per attempt: which shell, how long it took, how it ended. */
  readonly log?: (line: string) => void;
}

type ShellAnswer =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'failed' }
  | { readonly kind: 'timeout' };

/**
 * The PATH the person's login shell sets up, as a new terminal would have it,
 * or null when there is none to read: Windows (an app gets the full PATH from
 * the start), no shell to ask, or none that answers. A shell that fails makes
 * way for the next one (`SHELL`, the account's own, the system's); one that
 * does not answer in time ends the search, as the next would likely wait too.
 * On macOS launchd's PATH for apps comes last.
 */
export async function readLoginShellPath(opts: LoginShellPathOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  if (platform === 'win32') return null;
  const log = opts.log ?? (() => undefined);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shells = [
    env.SHELL,
    'userShell' in opts ? opts.userShell : accountShell(),
    'fallbackShell' in opts ? opts.fallbackShell : platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
  ];
  const tried = new Set<string>();
  for (const candidate of shells) {
    const shell = candidate?.trim();
    if (!shell || tried.has(shell)) continue;
    tried.add(shell);
    const started = Date.now();
    const answer = await askShell(shell, env, timeoutMs);
    if (answer.kind === 'path') {
      log(`terminal PATH: read from ${shell} in ${Date.now() - started} ms`);
      return answer.path;
    }
    if (answer.kind === 'timeout') {
      log(`terminal PATH: ${shell} did not answer in ${timeoutMs} ms`);
      break;
    }
    log(`terminal PATH: ${shell} failed`);
  }
  if (platform !== 'darwin') return null;
  const fromLaunchd = await (opts.launchctl ?? readLaunchctlPath)().catch(() => null);
  if (fromLaunchd) log('terminal PATH: taken from launchctl');
  return fromLaunchd;
}

function accountShell(): string | undefined {
  try {
    return userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
}

function askShell(shell: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ShellAnswer> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (answer: ShellAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(answer);
    };
    // -i and -l: the same profile files a terminal window reads, where PATH is set.
    // In a process group of its own, so what the profile starts goes with it, and
    // nothing the profile signals reaches the app.
    const child = spawn(shell, ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const deadline = setTimeout(() => {
      stop();
      finish({ kind: 'timeout' });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      if (out.length > MAX_OUTPUT_BYTES) stop();
    });
    child.on('error', () => finish({ kind: 'failed' }));
    child.on('close', (code) => {
      const start = out.indexOf(MARK);
      const end = out.indexOf(MARK, start + MARK.length);
      const found = start >= 0 && end > start ? out.slice(start + MARK.length, end).trim() : '';
      finish(code === 0 && found ? { kind: 'path', path: found } : { kind: 'failed' });
    });
  });
}

function readLaunchctlPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', ['getenv', 'PATH'], { timeout: LAUNCHCTL_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

/** `current` with the terminal's PATH in front: its folders in its order, then the others, each once. */
export function withLoginShellPath(current: string | undefined, loginShellPath: string | null, delimiter = ':'): string {
  const dirs = [...(loginShellPath ?? '').split(delimiter), ...(current ?? '').split(delimiter)].filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}
