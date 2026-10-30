import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A change takes milliseconds; a lock this old was left by a process that died. */
const STALE_LOCK_MS = 10_000;
const LOCK_RETRY_MS = 15;

/** Test seams only: let a test hold a waiter at the exact moment a race needs. */
export interface FileLockHooks {
  /** Called when this waiter has judged the lock stale, before anything is removed. */
  readonly onStaleLockSeen?: () => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ageOf = (path: string): Promise<number> =>
  stat(path).then(
    (st) => Date.now() - st.mtimeMs,
    () => 0,
  );

/**
 * Remove a stale lock, but only as the one waiter holding `<lock>.takeover`,
 * and only if the lock is still stale then. Without this, two waiters could
 * both judge the dead lock stale and the slower one would remove the fresh
 * lock the faster one had just taken, so both would change the file at once.
 */
async function removeStaleLock(lock: string): Promise<void> {
  const guard = `${lock}.takeover`;
  try {
    await (await open(guard, 'wx')).close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Another waiter is taking over. A guard this old was left by one that died.
    if ((await ageOf(guard)) > STALE_LOCK_MS) await unlink(guard).catch(() => undefined);
    else await sleep(LOCK_RETRY_MS);
    return;
  }
  try {
    if ((await ageOf(lock)) > STALE_LOCK_MS) await unlink(lock).catch(() => undefined);
  } finally {
    await unlink(guard).catch(() => undefined);
  }
}

/**
 * Hold `<file>.lock` while `fn` runs, so processes sharing the file change it
 * one at a time. The lock is a file created only if absent (`open(…, 'wx')`,
 * atomic on every platform); a stale one is removed and claimed again, by one
 * waiter at a time ({@link removeStaleLock}).
 */
export async function withFileLock<R>(
  file: string,
  fn: () => Promise<R>,
  hooks: FileLockHooks = {},
): Promise<R> {
  const lock = `${file}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.writeFile(String(process.pid)).finally(() => handle.close());
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    if ((await ageOf(lock)) > STALE_LOCK_MS) {
      await hooks.onStaleLockSeen?.();
      await removeStaleLock(lock);
    } else await sleep(LOCK_RETRY_MS);
  }
  try {
    return await fn();
  } finally {
    await unlink(lock).catch(() => undefined);
  }
}
