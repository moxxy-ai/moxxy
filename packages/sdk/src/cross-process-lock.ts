import { open, readdir, stat, unlink } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Cross-process "fire exactly once" lock.
 *
 * The problem it solves: several moxxy runner processes can run concurrently
 * (the desktop spawns one `moxxy serve` per workspace) and each one runs its own
 * scheduler poller / workflow-trigger wiring over the SAME shared on-disk store.
 * An in-memory mutex (per-process) can't stop two processes from both deciding
 * the same due schedule should fire — so a cron workflow fires N times, once per
 * runner. This lock makes a given logical fire claimable by exactly one process.
 *
 * Mechanism: an atomic exclusive file create (`open(path, 'wx')`) under a shared
 * directory. The first caller to create the marker for a key wins; every other
 * caller sees `EEXIST` and backs off. A marker older than `ttlMs` is treated as
 * a crashed holder and reclaimed, so a process that died between claiming and
 * finishing can't wedge a schedule forever. `sweep()` removes expired markers so
 * the directory can't grow without bound.
 *
 * This is a SECONDARY guard: the durable dedup is still each store's persisted
 * `lastRunAt`/`fired` state, which propagates through the shared file. The lock
 * only closes the sub-second window where two pollers tick simultaneously before
 * either has persisted. A rare double-fire after a crashed-holder reclaim is
 * therefore acceptable — the persisted state catches the steady-state case.
 *
 * Keys must be filesystem-safe-ish; any char outside `[A-Za-z0-9._@-]` is
 * replaced with `_`. Callers should build keys from already-safe components
 * (ulids, epoch-ms instants) so distinct logical fires never collide after
 * sanitization.
 */
export interface CrossProcessFireLockOptions {
  /** Directory the marker files live under. Created on demand. */
  readonly dir: string;
  /**
   * How long a marker is honored before it's considered abandoned (the holder
   * crashed) and reclaimable. Default 10 minutes — comfortably longer than any
   * poll interval + clock skew, short enough that a crash doesn't strand a
   * recurring schedule for long.
   */
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;

export class CrossProcessFireLock {
  private readonly dir: string;
  private readonly ttlMs: number;

  constructor(opts: CrossProcessFireLockOptions) {
    this.dir = opts.dir;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Claim `key` for the current process. Returns `true` iff THIS call created
   * the marker (won the race) — exactly one concurrent caller across all
   * processes gets `true` for a given key until the marker is swept or expires.
   * Returns `false` when another live process already holds it.
   *
   * Never throws for the common races (EEXIST, a marker unlinked out from under
   * us): those resolve to a definite true/false. A genuinely unexpected fs error
   * (e.g. permission denied on the lock dir) propagates so the caller can decide
   * — the scheduler treats a throw as "don't fire" to stay safe.
   */
  async claim(key: string, now: number = Date.now()): Promise<boolean> {
    const file = this.fileFor(key);
    await mkdir(this.dir, { recursive: true });
    if (await this.tryCreate(file)) return true;
    // Marker exists. Reclaim it only if it's stale (the previous holder crashed
    // before sweeping it). The reclaim is best-effort: the `wx` re-create is the
    // atomic arbiter, so even if two processes both see a stale marker, only one
    // re-creates it successfully.
    let stale = false;
    try {
      const st = await stat(file);
      stale = now - st.mtimeMs > this.ttlMs;
    } catch {
      // Vanished between our create attempt and the stat — race with a sweep or
      // another reclaim. Treat as free and try once more.
      return this.tryCreate(file);
    }
    if (!stale) return false;
    await unlink(file).catch(() => {});
    return this.tryCreate(file);
  }

  /** Remove markers older than `ttlMs`. Best-effort; a missing dir → 0. */
  async sweep(now: number = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.lock')) continue;
      const file = join(this.dir, name);
      try {
        const st = await stat(file);
        if (now - st.mtimeMs > this.ttlMs) {
          await unlink(file);
          removed += 1;
        }
      } catch {
        // racing sweep/unlink or unreadable entry — skip.
      }
    }
    return removed;
  }

  private async tryCreate(file: string): Promise<boolean> {
    try {
      const fh = await open(file, 'wx');
      await fh.close();
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  private fileFor(key: string): string {
    const safe = key.replace(/[^A-Za-z0-9._@-]/g, '_');
    return join(this.dir, `${safe}.lock`);
  }
}
