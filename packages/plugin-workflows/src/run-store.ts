import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Workflow, type WorkflowRunDeps } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { ulid } from 'ulid';

/**
 * Persistence for paused workflow runs (the `awaitInput` flow). When the DAG
 * pauses on an `awaitInput` step it writes a checkpoint here; `resumeWorkflowRun`
 * loads it, replays the operator reply into the retained child session, and
 * continues the DAG. Checkpoints live under `~/.moxxy/workflow-runs/active/`.
 */

export interface SerializedStepState {
  status: string;
  output: string;
  error?: string;
  startedAt: number;
  endedAt: number;
}

export interface WorkflowRunCheckpoint {
  readonly runId: string;
  readonly workflow: Workflow;
  readonly trigger: string;
  readonly inputs: Record<string, unknown>;
  readonly states: Record<string, SerializedStepState>;
  /**
   * Variables set by logic steps BEFORE the pause. Restored on resume so a
   * `bridge` that ran ahead of an `awaitInput` step isn't silently dropped
   * (otherwise downstream `{{ vars.x }}` would render empty after resume).
   */
  readonly vars: Record<string, unknown>;
  readonly pendingStepId: string;
  readonly interactionAgentId: string;
  readonly startedAt: number;
  /** JSON-serializable subset of deps references — resolved at resume time. */
  readonly parentTurnId?: string;
}

/**
 * Canonical ulid shape (Crockford base32, 26 chars). `runId` reaches `load`/
 * `remove` straight from the operator/UI across the IPC/WS/mobile trust
 * boundary, so it is untrusted: anything but a real ulid (e.g.
 * `../../../etc/passwd`) is rejected before it touches the filesystem,
 * defeating path traversal through `path.join`.
 */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Resolve `<dir>/<runId>.json` only for a syntactically valid ulid, and assert
 * the result stays inside `dir` (belt-and-suspenders against any future shape
 * change). Returns null for an invalid id or an escaping path.
 */
function checkpointFile(dir: string, runId: string): string | null {
  if (!ULID_RE.test(runId)) return null;
  const file = path.join(dir, `${runId}.json`);
  const root = path.resolve(dir) + path.sep;
  if (!path.resolve(file).startsWith(root)) return null;
  return file;
}

/** Minimal structural guard for a deserialized checkpoint (corrupt/tampered file). */
function isValidCheckpoint(value: unknown): value is WorkflowRunCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  const wf = c.workflow as { steps?: unknown } | undefined;
  return (
    !!wf &&
    typeof wf === 'object' &&
    Array.isArray(wf.steps) &&
    !!c.states &&
    typeof c.states === 'object' &&
    typeof c.pendingStepId === 'string'
  );
}

export class WorkflowRunStore {
  constructor(private readonly dir = moxxyPath('workflow-runs', 'active')) {}

  async save(checkpoint: Omit<WorkflowRunCheckpoint, 'runId'>): Promise<string> {
    const runId = ulid();
    const file = path.join(this.dir, `${runId}.json`);
    const payload: WorkflowRunCheckpoint = { ...checkpoint, runId };
    // The shared atomic helper writes a pid+uuid-unique temp then renames
    // (and mkdir's the parent), so two concurrent saves never collide on a
    // fixed `${file}.tmp` and a failed write leaves no orphan temp behind.
    await writeFileAtomic(file, JSON.stringify(payload));
    return runId;
  }

  async load(runId: string): Promise<WorkflowRunCheckpoint | null> {
    const file = checkpointFile(this.dir, runId);
    if (!file) return null;
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      // A corrupt/truncated/tampered checkpoint must not crash resume — return
      // null so callers surface the structured "no paused run" failure shape.
      return isValidCheckpoint(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async remove(runId: string): Promise<void> {
    const file = checkpointFile(this.dir, runId);
    if (!file) return;
    try {
      await fs.unlink(file);
    } catch {
      // ignore
    }
  }

  /**
   * Delete checkpoint files older than `maxAgeMs` (by mtime). Paused runs that
   * are never resumed (the common case while `awaitInput` is gated — see
   * schema.ts — and in general after a crash) would otherwise accumulate
   * `<ulid>.json` files under `active/` forever. Returns the count removed.
   * Best-effort: a missing dir or an unreadable entry is skipped, not thrown.
   */
  async sweepStale(maxAgeMs = DEFAULT_CHECKPOINT_TTL_MS, now = Date.now()): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return 0;
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.dir, name);
      try {
        const st = await fs.stat(file);
        if (now - st.mtimeMs > maxAgeMs) {
          await fs.unlink(file);
          removed += 1;
        }
      } catch {
        // racing unlink / unreadable entry — skip.
      }
    }
    return removed;
  }
}

/** Stale paused-run checkpoints are swept after 7 days by default. */
export const DEFAULT_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const defaultWorkflowRunStore = new WorkflowRunStore();

/** Optional hook on {@link WorkflowRunDeps} — plugin-local extension. */
export interface WorkflowRunDepsWithStore extends WorkflowRunDeps {
  readonly runStore?: WorkflowRunStore;
}
