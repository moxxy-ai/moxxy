import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Workflow, type WorkflowExecutorDef, type WorkflowRunDeps, type WorkflowRunResult } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import { ulid } from 'ulid';
import { dagExecutor } from './executor/dag.js';

/**
 * Runs a workflow through the active executor and appends a JSONL run record
 * to `~/.moxxy/workflow-runs/` for `/workflows inspect`. The executor itself
 * is fs-free; record-keeping lives here so the executor stays unit-testable.
 */

export function defaultRunRecordDir(): string {
  return moxxyPath('workflow-runs');
}

/** Run records older than this (by mtime) are swept by default — 30 days. */
export const DEFAULT_RUN_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete `*.jsonl` run-record files older than `maxAgeMs` (by mtime). Every
 * `runWorkflow` appends one and nothing else removes them, so over months of
 * scheduled runs they grow without bound and slow `readLastRun`. Mirrors
 * {@link WorkflowRunStore.sweepStale} for paused checkpoints; call from the same
 * workflows-boot hook. Best-effort: a missing dir / unreadable entry is skipped,
 * not thrown. Returns the count removed.
 */
export async function sweepStaleRecords(
  dir = defaultRunRecordDir(),
  maxAgeMs = DEFAULT_RUN_RECORD_TTL_MS,
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
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

export interface RunWorkflowOptions {
  /** Active executor; falls back to the built-in `dag`. */
  readonly executor?: WorkflowExecutorDef | null;
  /** Override the run-record directory (tests). Pass null to skip recording. */
  readonly recordDir?: string | null;
}

export async function runWorkflow(
  workflow: Workflow,
  deps: WorkflowRunDeps,
  opts: RunWorkflowOptions = {},
): Promise<WorkflowRunResult> {
  const executor = opts.executor ?? dagExecutor;
  const startedAt = (deps.now ?? Date.now)();
  const result = await executor.run(workflow, deps);
  if (opts.recordDir !== null) {
    await writeRunRecord(workflow, result, startedAt, executor.name, deps, opts.recordDir ?? defaultRunRecordDir()).catch(
      (err) =>
        deps.logger?.warn?.('workflow: failed to write run record', {
          error: err instanceof Error ? err.message : String(err),
        }),
    );
  }
  return result;
}

async function writeRunRecord(
  workflow: Workflow,
  result: WorkflowRunResult,
  startedAt: number,
  executorName: string,
  deps: WorkflowRunDeps,
  dir: string,
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${workflow.name}-${ulid().slice(-6)}.jsonl`);
  const lines = [
    JSON.stringify({
      kind: 'run',
      workflow: workflow.name,
      executor: executorName,
      startedAt,
      trigger: deps.trigger ?? 'manual',
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
    }),
    ...result.steps.map((s) => JSON.stringify({ kind: 'step', ...s })),
    JSON.stringify({ kind: 'output', output: result.output }),
  ];
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
}
