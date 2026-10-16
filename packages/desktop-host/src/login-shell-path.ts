import { spawn } from 'node:child_process';

/**
 * An app started from Finder, the Dock or a Linux menu gets a short system
 * PATH, not the one the person's terminal builds in its profile. Programs were
 * then found in another order than the terminal finds them: an old Homebrew
 * `claude` won over the current one in `~/.local/bin`, and one installed
 * where only the profile points (pnpm, bun, mise) was not found at all.
 */

const MARK = '__MOXXY_LOGIN_SHELL_PATH__';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface LoginShellPathOptions {
  readonly platform?: NodeJS.Platform;
  /** Whose shell and home; `SHELL` names the shell. */
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

/**
 * The PATH the person's login shell sets up, as a new terminal would have it,
 * or null when there is none to read: Windows (an app gets the full PATH from
 * the start), no `SHELL`, or a shell that fails or does not answer in time.
 */
export function readLoginShellPath(opts: LoginShellPathOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const shell = env.SHELL?.trim();
  if ((opts.platform ?? process.platform) === 'win32' || !shell) return Promise.resolve(null);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    // -i and -l: the same profile files a terminal window reads, where PATH is set.
    const child = spawn(shell, ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      if (out.length > MAX_OUTPUT_BYTES) child.kill('SIGKILL');
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      const start = out.indexOf(MARK);
      const end = out.indexOf(MARK, start + MARK.length);
      const found = start >= 0 && end > start ? out.slice(start + MARK.length, end).trim() : '';
      finish(code === 0 && found ? found : null);
    });
  });
}

/** `current` with the terminal's PATH in front: its folders in its order, then the others, each once. */
export function withLoginShellPath(current: string | undefined, loginShellPath: string | null, delimiter = ':'): string {
  const dirs = [...(loginShellPath ?? '').split(delimiter), ...(current ?? '').split(delimiter)].filter(Boolean);
  return [...new Set(dirs)].join(delimiter);
}
