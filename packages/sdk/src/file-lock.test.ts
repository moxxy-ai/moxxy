import { mkdtemp, open, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { withFileLock } from './file-lock.js';

vi.mock('node:fs/promises', async (load) => {
  const fs = await load<typeof import('node:fs/promises')>();
  return { ...fs, open: vi.fn(fs.open) };
});

describe('withFileLock', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moxxy-file-lock-'));
    file = join(dir, 'store.json');
  });
  afterEach(async () => {
    await removeDir(dir);
  });

  async function leaveStale(path: string): Promise<void> {
    await writeFile(path, '12345');
    const longAgo = new Date(Date.now() - 60_000);
    await utimes(path, longAgo, longAgo);
  }

  it('lets only one of two waiters take over a lock left behind', async () => {
    // Both waiters judge the same dead lock stale. The first takes it over and
    // starts its change; only then does the second act on its stale verdict.
    // It must not remove the first one's fresh lock and run at the same time.
    await leaveStale(`${file}.lock`);
    let inside = 0;
    let mostAtOnce = 0;
    let firstInside!: () => void;
    const firstIsInside = new Promise<void>((resolve) => (firstInside = resolve));
    const change = (onEnter?: () => void) => async () => {
      inside += 1;
      mostAtOnce = Math.max(mostAtOnce, inside);
      onEnter?.();
      await new Promise((r) => setTimeout(r, 50));
      inside -= 1;
    };

    await Promise.all([
      withFileLock(file, change(firstInside)),
      withFileLock(file, change(), { onStaleLockSeen: () => firstIsInside }),
    ]);

    expect(mostAtOnce).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('retries exclusive creation while the previous lock or takeover guard is pending deletion', async () => {
    const lock = file + '.lock';
    await leaveStale(lock);
    const pendingDeletion = new Set([lock, lock + '.takeover']);
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await vi.mocked(open).withImplementation(async (path, flags, mode) => {
      if (pendingDeletion.delete(String(path))) throw Object.assign(new Error('pending deletion'), { code: 'EPERM' });
      return fs.open(path, flags, mode);
    }, async () => {
      expect(await withFileLock(file, async () => 'done')).toBe('done');
    });
    expect(pendingDeletion.size).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it('still takes over when a waiter died while taking over a lock', async () => {
    await leaveStale(`${file}.lock`);
    await leaveStale(`${file}.lock.takeover`);

    expect(await withFileLock(file, async () => 'done')).toBe('done');
    expect(await readdir(dir)).toEqual([]);
  });
});
