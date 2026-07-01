/**
 * Global single-flight lock for collaborations. Only ONE collaboration may run
 * at a time across the whole machine (each spawns a fleet of agent processes —
 * running several would thrash resources and contend for the same repo's
 * worktrees). The lock is a small JSON file at ~/.moxxy/collab/active.lock so it
 * works across the separate runner processes the desktop spawns per workspace.
 *
 * Staleness: the lock records the holding runner's pid; if that process is gone
 * (a crash) the lock is reclaimed automatically on the next attempt.
 */

import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  type CollabLockInfo,
  collabLockPath,
  isCollabHolderAlive as isAlive,
  readCollabLock as readRaw,
} from './collab-store.js';

export const COLLAB_LOCK_PATH = join(homedir(), '.moxxy', 'collab', 'active.lock');

// The lock path, defensive lock read, and liveness probe live in the shared
// on-disk-layout module so the desktop host reads the EXACT same contract; this
// file owns only the write/acquire/release lifecycle that the coordinator runs.
export { collabLockPath, type CollabLockInfo };

/** The currently-active collaboration, or null. Reclaims a stale (dead-pid) lock. */
export function readActiveCollab(): CollabLockInfo | null {
  const info = readRaw();
  if (!info) return null;
  if (!isAlive(info.pid)) {
    try {
      unlinkSync(collabLockPath());
    } catch {
      // already gone / racing another reclaimer
    }
    return null;
  }
  return info;
}

/** Acquire the global lock, or report the live holder. The same session
 *  re-acquiring (idempotent) is allowed.
 *
 *  Acquisition is ATOMIC: `openSync(path, 'wx')` exclusively creates the lock
 *  file, so two runner processes racing from a free state can't both win — the
 *  loser gets EEXIST. This closes the read-then-write TOCTOU window that let two
 *  coordinators run full agent fleets against the same repo. A stale lock (dead
 *  pid, or our own prior session) is reclaimed by unlinking once and retrying. */
export function tryAcquireCollabLock(args: {
  sessionId: string;
  task: string;
  startedAtMs: number;
  /** The coordinator runner socket a UI attaches to, recorded so readers can
   *  discover it without knowing the run id. Defaults to '' when unknown. */
  runnerSocket?: string;
}): { ok: true } | { ok: false; holder: CollabLockInfo } {
  const path = collabLockPath();
  mkdirSync(dirname(path), { recursive: true });
  const info: CollabLockInfo = {
    pid: process.pid,
    sessionId: args.sessionId,
    task: args.task,
    startedAtMs: args.startedAtMs,
    runnerSocket: args.runnerSocket ?? '',
  };
  const payload = JSON.stringify(info);

  // Bounded retries: each EEXIST either reports a live holder (fail) or reclaims
  // a stale/own lock and retries. The bound prevents an unbounded spin if two
  // processes keep clobbering each other's reclaim; on exhaustion we fail closed
  // (report the holder) rather than proceed without the lock.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(path, 'wx'); // exclusive create — fails if it already exists
      try {
        writeFileSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      return { ok: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const existing = readRaw();
      // A live holder from a DIFFERENT session blocks us.
      if (existing && existing.sessionId !== args.sessionId && isAlive(existing.pid)) {
        return { ok: false, holder: existing };
      }
      // Stale (dead pid) or our own prior session → unlink once and retry the
      // exclusive create. If a racing reclaimer beats us, the next EEXIST re-reads
      // the holder.
      try {
        unlinkSync(path);
      } catch {
        // already removed by a racing reclaimer
      }
    }
  }
  // Exhausted retries: a live competitor keeps winning. Fail closed.
  const holder = readActiveCollab() ?? readRaw();
  if (holder) return { ok: false, holder };
  return { ok: false, holder: info };
}

/** Release the lock if (and only if) this session holds it. */
export function releaseCollabLock(sessionId: string): void {
  const info = readRaw();
  if (info && info.sessionId === sessionId) {
    try {
      unlinkSync(collabLockPath());
    } catch {
      // already gone
    }
  }
}

/**
 * Force-release the lock regardless of holder. For the user's explicit "End the
 * collaboration" action: if the coordinator turn is also aborted, its own finally
 * releases the lock, but a stale lock from a crashed prior run (or one whose
 * coordinator can't be reached) would otherwise block every new start forever.
 * Returns the holder it cleared (if any) so the caller can report it.
 */
export function forceReleaseCollabLock(): CollabLockInfo | null {
  const info = readRaw();
  try {
    unlinkSync(collabLockPath());
  } catch {
    // already gone
  }
  return info;
}
