/**
 * The on-disk layout contract for collaborations — the single source of truth
 * for WHERE the coordinator writes its state and HOW to read it back safely.
 *
 * Two separate processes touch this layout:
 *   - the collaborative coordinator (this package, in a runner process), which
 *     WRITES the single-flight lock + archives finished runs, and
 *   - the desktop host's IPC handlers (`@moxxy/desktop-host`), which READ them
 *     directly off disk to power the Collaborate tab — no runner round-trip, so
 *     a collaboration running in ANY workspace's runner is still visible.
 *
 * Keeping the path derivation + the defensive parse here (rather than
 * hand-edited in each reader) means the lock/runs locations are the
 * coordinator's contract, not three drifting copies. Deliberately Node-stdlib
 * only (no `@moxxy/sdk`, no `zod`) so a cross-package reader pays nothing to
 * consume it, and the records on disk stay self-describing plain JSON.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `$MOXXY_HOME` or `~/.moxxy` — the single source of truth for the home dir,
 *  matching `@moxxy/sdk`'s `moxxyHome()` (inlined to avoid an entry-point dep). */
export function moxxyHome(): string {
  return process.env.MOXXY_HOME ?? join(homedir(), '.moxxy');
}

/** `~/.moxxy/collab/active.lock`, unless `MOXXY_COLLAB_LOCK` overrides it
 *  (tests, multi-tenant). The override does NOT route through `MOXXY_HOME` — it
 *  is an absolute path to the lock itself — so it stays a separate knob. */
export function collabLockPath(): string {
  return process.env.MOXXY_COLLAB_LOCK || join(moxxyHome(), 'collab', 'active.lock');
}

/** `~/.moxxy/collab/runs` — the archive directory (one JSON record per run). */
export function collabRunsDir(): string {
  return join(moxxyHome(), 'collab', 'runs');
}

/** The coordinator's single-flight lock record. `pid` is the only field handed
 *  to `process.kill` for the liveness probe; the rest are display-only EXCEPT
 *  `runnerSocket`, which a UI reads to attach to the (headless) coordinator's
 *  runner and drive/monitor the run. Empty string when unknown (older lock, or a
 *  coordinator without a runner socket). */
export interface CollabLockInfo {
  readonly pid: number;
  readonly sessionId: string;
  readonly task: string;
  readonly startedAtMs: number;
  readonly runnerSocket: string;
}

/**
 * Parse a lock file's JSON and verify it carries a usable numeric pid. A
 * truncated/corrupt lock (non-object, missing/garbage pid) is treated as "no
 * live holder" (null) rather than handed to `process.kill` with a bad value.
 * The optional display fields are coerced to safe defaults so a wrong-typed
 * `task`/`sessionId` can never propagate to the UI or a downstream check.
 */
export function parseCollabLock(raw: string): CollabLockInfo | null {
  let info: unknown;
  try {
    info = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof info !== 'object' || info === null) return null;
  const rec = info as Record<string, unknown>;
  if (typeof rec.pid !== 'number' || !Number.isInteger(rec.pid) || rec.pid <= 0) return null;
  return {
    pid: rec.pid,
    sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
    task: typeof rec.task === 'string' ? rec.task : '',
    startedAtMs: typeof rec.startedAtMs === 'number' ? rec.startedAtMs : 0,
    runnerSocket: typeof rec.runnerSocket === 'string' ? rec.runnerSocket : '',
  };
}

/** Read + parse the lock at `collabLockPath()`, or null if absent/corrupt. */
export function readCollabLock(): CollabLockInfo | null {
  try {
    return parseCollabLock(readFileSync(collabLockPath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Liveness probe for a lock holder. `process.kill(pid, 0)` signals nothing but
 * still raises if the process is gone: ESRCH = dead → not alive; EPERM = exists
 * but isn't ours to signal → still alive (treat as held).
 */
export function isCollabHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface CollabRunAgent {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly subtask: string;
  readonly doneSummary?: string;
}

export interface CollabRunRecord {
  readonly runId: string;
  readonly task: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  /** completed = reached collab_completed; aborted = user/abort; failed = error before completion. */
  readonly outcome: 'completed' | 'aborted' | 'failed';
  readonly parallel: boolean;
  readonly gitRepo: boolean;
  readonly agents: ReadonlyArray<CollabRunAgent>;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly board: ReadonlyArray<{ id: string; title: string; status: string; owner?: string; paths?: ReadonlyArray<string> }>;
  readonly contracts: ReadonlyArray<{ id: string; title: string; owner: string; status: string; version: number }>;
  readonly messageCount: number;
  readonly merge?: {
    readonly merged: ReadonlyArray<string>;
    readonly promoted: boolean;
    readonly conflicts: number;
    readonly stagingBranch?: string;
  };
  /** The shared brief (goal + intent) the run was seeded with. */
  readonly brief?: string;
}

/** All archived runs, newest first (by start time), capped at `limit`. Skips a
 *  corrupt record rather than failing the whole list; returns [] when no dir. */
export function listRunRecords(limit = 50): CollabRunRecord[] {
  let files: string[];
  try {
    files = readdirSync(collabRunsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: CollabRunRecord[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(join(collabRunsDir(), f), 'utf8')) as CollabRunRecord);
    } catch {
      // skip a corrupt record rather than failing the whole list
    }
  }
  out.sort((a, b) => b.startedAtMs - a.startedAtMs);
  return out.slice(0, limit);
}
