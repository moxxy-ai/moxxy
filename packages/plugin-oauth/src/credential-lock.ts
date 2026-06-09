/**
 * Per-credential refresh serialization.
 *
 * OAuth providers with ROTATING single-use refresh tokens (Anthropic's Claude
 * subscription, OpenAI's Codex/ChatGPT plan) invalidate the previous
 * refresh_token on every refresh. Two concurrent refreshes with the same
 * stored token therefore race: one wins, the other burns a now-dead token and
 * logs the user out. `withCredentialLock` serializes "refresh + persist"
 * critical sections at two levels:
 *
 *   1. In-process: a per-key `Mutex` (promise chain) so concurrent consumers
 *      in one process (e.g. the chat provider and the whisper-stt transcriber
 *      sharing the codex credential) coalesce into a single refresh — the
 *      followers re-read the vault under the lock and reuse the winner's
 *      rotated tokens.
 *   2. Cross-process: a best-effort O_EXCL lockfile under
 *      `<moxxy home>/locks/` with stale-lock takeover, so a TUI and a desktop
 *      runner refreshing the same credential queue up instead of racing.
 *
 * The file lock is deliberately best-effort: if the lock directory is
 * unusable, or a live-but-slow holder keeps it past `waitMs`, we proceed
 * WITHOUT the lock rather than deadlocking auth — the vault's read-merge-write
 * persistence and the callers' invalid_grant re-read-retry recovery keep the
 * losing side recoverable even then.
 */

import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MoxxyError, createMutex, moxxyPath, type Mutex } from '@moxxy/sdk';

export interface CredentialLockOptions {
  /** Directory holding the lock files. Default `<moxxy home>/locks`. */
  readonly dir?: string;
  /**
   * Take over a lock file whose mtime is older than this (holder crashed
   * without releasing). Default 60s — comfortably above a worst-case retried
   * token refresh.
   */
  readonly staleMs?: number;
  /** Poll interval while waiting on a held lock. Default 150ms. */
  readonly pollMs?: number;
  /**
   * Max time to wait for the file lock before proceeding WITHOUT it
   * (best effort — never deadlock auth on a wedged lock). Default 30s.
   */
  readonly waitMs?: number;
}

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_POLL_MS = 150;
const DEFAULT_WAIT_MS = 30_000;

/**
 * In-process locks, keyed by sanitized credential key. Module-level so every
 * consumer of this package instance (providers, stt, tools) shares them.
 */
const inProcessLocks = new Map<string, Mutex>();

/**
 * Run `fn` while holding the per-credential lock (in-process mutex +
 * best-effort cross-process lockfile). Callers should RE-READ their stored
 * credential inside `fn` — a queued waiter usually finds the winner's
 * freshly rotated tokens and can skip its own refresh entirely.
 */
export async function withCredentialLock<T>(
  key: string,
  fn: () => Promise<T>,
  opts: CredentialLockOptions = {},
): Promise<T> {
  const safe = sanitizeKey(key);
  let mutex = inProcessLocks.get(safe);
  if (!mutex) {
    mutex = createMutex();
    inProcessLocks.set(safe, mutex);
  }
  return mutex.run(async () => {
    const release = await acquireFileLock(
      join(opts.dir ?? moxxyPath('locks'), `${safe}.lock`),
      opts.staleMs ?? DEFAULT_STALE_MS,
      opts.pollMs ?? DEFAULT_POLL_MS,
      opts.waitMs ?? DEFAULT_WAIT_MS,
    );
    try {
      return await fn();
    } finally {
      await release();
    }
  });
}

/**
 * True for deterministic credential rejections from a token endpoint, as
 * opposed to transient network/5xx failures. Covers the AUTH_* codes (401/403
 * and refresh-specific failures) plus PROVIDER_BAD_REQUEST — `invalid_grant`
 * is canonically an HTTP 400 (RFC 6749 §5.2), which `classifyHttpStatus` maps
 * there. Used to decide whether a failed refresh is worth retrying with a
 * fresher refresh_token re-read from the vault (another process may have
 * rotated ours away).
 */
export function isAuthRejection(err: unknown): boolean {
  return (
    err instanceof MoxxyError &&
    (err.code === 'AUTH_INVALID' ||
      err.code === 'AUTH_DENIED' ||
      err.code === 'AUTH_EXPIRED' ||
      err.code === 'PROVIDER_BAD_REQUEST')
  );
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/**
 * O_EXCL ('wx') lockfile acquisition with stale takeover. Returns a release
 * function. Never throws: an unusable lock dir degrades to running unlocked.
 */
async function acquireFileLock(
  lockPath: string,
  staleMs: number,
  pollMs: number,
  waitMs: number,
): Promise<() => Promise<void>> {
  const deadline = Date.now() + waitMs;
  try {
    await mkdir(dirname(lockPath), { recursive: true });
  } catch {
    return async () => {};
  }
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, 'utf8');
      } finally {
        await handle.close().catch(() => {});
      }
      return async () => {
        await rm(lockPath, { force: true }).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Read-only FS, permissions, … — degrade to unlocked rather than
        // blocking the user's auth on infrastructure trouble.
        return async () => {};
      }
    }
    // Lock held — take over if the holder looks dead, else wait and re-try.
    try {
      const st = await stat(lockPath);
      if (Date.now() - st.mtimeMs > staleMs) {
        await rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
    } catch {
      continue; // released between open() and stat() — grab it on the next spin
    }
    if (Date.now() >= deadline) return async () => {};
    await sleep(pollMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
