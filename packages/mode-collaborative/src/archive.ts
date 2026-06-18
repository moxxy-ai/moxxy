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

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** Persist one run record. Best-effort: never throws (archiving must not sink a run). */
export function writeRunRecord(rec: CollabRunRecord): void {
  try {
    const dir = collabRunsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${rec.runId}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  } catch {
    // archiving is an enhancement, not a prerequisite
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
