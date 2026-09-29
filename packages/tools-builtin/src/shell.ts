import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
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
    // This tool is effectively POSIX-only (it spawns /bin/sh). Windows has
    // no process groups / negative-pid kill; a real port would shell out to
    // `taskkill /PID <pid> /T /F`. Until then, signal the direct child only.
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
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
 * Spawn `command` under /bin/sh with a secret-scrubbed env (model-supplied
 * `env` overlaid) and piped output. POSIX children lead their own process
 * group so {@link killTree} reaches every descendant.
 */
export function spawnShell(
  command: string,
  opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
): ChildProcess & { stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> } {
  return spawn('/bin/sh', ['-lc', command], {
    cwd: opts.cwd,
    env: { ...scrubbedEnv(process.env), ...(opts.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // `detached` only detaches the controlling terminal/group — piped stdio
    // and exit reporting are unaffected. Not meaningful on win32.
    detached: process.platform !== 'win32',
  });
}
