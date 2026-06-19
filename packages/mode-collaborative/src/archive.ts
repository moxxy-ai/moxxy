/**
 * Run archive — a durable history of every collaboration.
 *
 * Each finished run (completed, aborted, or failed) is written as one JSON
 * record under `~/.moxxy/collab/runs/<runId>.json`. This is what gives the
 * Collaborate UI a "past runs" list and lets a user revisit what a team
 * produced — the transient socket/worktree dirs are cleaned up, but the record
 * of the run survives. Kept self-describing (plain JSON, no imports needed to
 * read it) so the desktop can list the directory directly.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Hard retention cap on the archive dir. Without this, every collaboration ever
 *  run leaks one JSON file under ~/.moxxy/collab/runs forever — the desktop
 *  history reader already caps its own fan-out, but the directory itself grows
 *  unbounded. We keep the newest `MAX_RUN_RECORDS` and prune the rest on write. */
export const MAX_RUN_RECORDS = 200;

/** `$MOXXY_HOME` or `~/.moxxy` — the single source of truth for the home dir,
 *  matching `@moxxy/sdk`'s `moxxyHome()` (inlined to avoid an entry-point dep). */
function moxxyHome(): string {
  return process.env.MOXXY_HOME ?? join(homedir(), '.moxxy');
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

/** `~/.moxxy/collab/runs` — the archive directory. */
export function collabRunsDir(): string {
  return join(moxxyHome(), 'collab', 'runs');
}

/** Persist one run record. Best-effort: never throws (archiving must not sink a
 *  run). Writes atomically (tmp + rename) so a crash mid-write can't leave a
 *  half-written, unparseable record, then prunes the dir to its retention cap. */
export function writeRunRecord(rec: CollabRunRecord): void {
  try {
    const dir = collabRunsDir();
    mkdirSync(dir, { recursive: true });
    const final = join(dir, `${rec.runId}.json`);
    // A unique-ish tmp name so concurrent writers (different runs) don't collide.
    const tmp = `${final}.${process.pid}.${Date.now().toString(36)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
    renameSync(tmp, final); // POSIX-atomic; crash mid-write leaves the prior file intact
  } catch {
    // archiving is an enhancement, not a prerequisite
  }
  pruneRunRecords();
}

/** Enforce the retention cap: keep the newest `MAX_RUN_RECORDS` VALID archive
 *  files, delete the rest. Valid records are ranked among themselves by
 *  `startedAtMs`. Corrupt/foreign/unparseable `.json` files carry no value AND
 *  their mtime lives in a different magnitude than `startedAtMs` (mtime is always
 *  ~now in epoch-ms; a real run's `startedAtMs` can be far older), so ranking them
 *  by mtime in the same space made a fresh corrupt file outrank every legitimate
 *  record and pin the dir open forever — the opposite of "evictable". Instead we
 *  sort corrupt files strictly BELOW every valid record (oldest among themselves
 *  by mtime), so a bad file is always the FIRST to be evicted and can never wedge
 *  the sweep. A leftover `.tmp` is always swept. Best-effort, bounded, never throws. */
function pruneRunRecords(max: number = MAX_RUN_RECORDS): void {
  try {
    const dir = collabRunsDir();
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // no dir yet
    }
    const ranked: Array<{ file: string; key: number; valid: boolean }> = [];
    for (const name of names) {
      const full = join(dir, name);
      // Sweep stale temp files from interrupted atomic writes regardless of cap.
      if (name.endsWith('.tmp')) {
        rmSync(full, { force: true });
        continue;
      }
      if (!name.endsWith('.json')) continue;
      let key: number;
      let valid = false;
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as { startedAtMs?: unknown };
        if (typeof parsed.startedAtMs === 'number' && Number.isFinite(parsed.startedAtMs)) {
          key = parsed.startedAtMs;
          valid = true;
        } else {
          // Parses but has no usable timestamp → treat as foreign/corrupt: rank by
          // mtime among the other corrupt files, strictly below every valid record.
          key = statSync(full).mtimeMs;
        }
      } catch {
        // Unparseable/corrupt or unreadable → rank by mtime among corrupt files.
        try {
          key = statSync(full).mtimeMs;
        } catch {
          continue; // vanished underneath us
        }
      }
      ranked.push({ file: full, key, valid });
    }
    if (ranked.length <= max) return;
    // Valid records sort ABOVE every corrupt file (newest valid first), so corrupt
    // files are always at the tail and evicted first; corrupt files tie-break by
    // mtime (oldest first). Both key spaces only ever compare like-with-like.
    ranked.sort((a, b) => {
      if (a.valid !== b.valid) return a.valid ? -1 : 1;
      return b.key - a.key; // newest first within each tier
    });
    for (const { file } of ranked.slice(max)) {
      rmSync(file, { force: true });
    }
  } catch {
    // pruning is housekeeping; a failure must never sink a run
  }
}

/** All archived runs, newest first (by start time), capped at `limit`. */
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

/** One archived run by id, or null. */
export function readRunRecord(runId: string): CollabRunRecord | null {
  try {
    return JSON.parse(readFileSync(join(collabRunsDir(), `${runId}.json`), 'utf8')) as CollabRunRecord;
  } catch {
    return null;
  }
}
