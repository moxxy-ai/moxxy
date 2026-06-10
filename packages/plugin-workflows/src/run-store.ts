import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { moxxyPath, type Workflow, type WorkflowRunDeps } from '@moxxy/sdk';
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
  readonly pendingStepId: string;
  readonly interactionAgentId: string;
  readonly startedAt: number;
  /** JSON-serializable subset of deps references — resolved at resume time. */
  readonly parentTurnId?: string;
}

export class WorkflowRunStore {
  constructor(private readonly dir = moxxyPath('workflow-runs', 'active')) {}

  async save(checkpoint: Omit<WorkflowRunCheckpoint, 'runId'>): Promise<string> {
    const runId = ulid();
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${runId}.json`);
    const payload: WorkflowRunCheckpoint = { ...checkpoint, runId };
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
    await fs.rename(tmp, file);
    return runId;
  }

  async load(runId: string): Promise<WorkflowRunCheckpoint | null> {
    const file = path.join(this.dir, `${runId}.json`);
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as WorkflowRunCheckpoint;
    } catch {
      return null;
    }
  }

  async remove(runId: string): Promise<void> {
    const file = path.join(this.dir, `${runId}.json`);
    try {
      await fs.unlink(file);
    } catch {
      // ignore
    }
  }
}

export const defaultWorkflowRunStore = new WorkflowRunStore();

/** Optional hook on {@link WorkflowRunDeps} — plugin-local extension. */
export interface WorkflowRunDepsWithStore extends WorkflowRunDeps {
  readonly runStore?: WorkflowRunStore;
}
