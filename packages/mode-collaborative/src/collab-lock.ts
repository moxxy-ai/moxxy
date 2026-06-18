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

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const COLLAB_LOCK_PATH = join(homedir(), '.moxxy', 'collab', 'active.lock');

/** Resolve the lock path; `MOXXY_COLLAB_LOCK` overrides it (tests, multi-tenant). */
export function collabLockPath(): string {
  return process.env.MOXXY_COLLAB_LOCK || COLLAB_LOCK_PATH;
}

export interface CollabLockInfo {
  readonly pid: number;
  readonly sessionId: string;
  readonly task: string;
  readonly startedAtMs: number;
}

function readRaw(): CollabLockInfo | null {
  try {
    return JSON.parse(readFileSync(collabLockPath(), 'utf8')) as CollabLockInfo;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours to signal (still alive); ESRCH = gone.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

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
 *  re-acquiring (idempotent) is allowed. */
export function tryAcquireCollabLock(args: {
  sessionId: string;
  task: string;
  startedAtMs: number;
}): { ok: true } | { ok: false; holder: CollabLockInfo } {
  mkdirSync(dirname(collabLockPath()), { recursive: true });
  const existing = readActiveCollab();
  if (existing && existing.sessionId !== args.sessionId) {
    return { ok: false, holder: existing };
  }
  const info: CollabLockInfo = { pid: process.pid, ...args };
  writeFileSync(collabLockPath(), JSON.stringify(info));
  return { ok: true };
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
