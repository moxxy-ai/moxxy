import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export interface WorkflowSummary {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly scope: string;
  readonly steps: number;
  readonly triggers: string;
}
export interface WorkflowRunResult {
  readonly ok: boolean;
  readonly output: string;
  readonly error?: string;
  readonly steps: ReadonlyArray<{ readonly id: string; readonly status: string; readonly error?: string }>;
  /** `paused` when the run parked on an awaitInput step (resume via `runId`). */
  readonly status?: 'completed' | 'paused' | 'failed';
  readonly runId?: string;
}
export interface WorkflowValidateResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}
export interface WorkflowSaveResult {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
}
export interface WorkflowDetailResult {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
  readonly yaml: string;
}
export interface WorkflowsClientView {
  list(): Promise<ReadonlyArray<WorkflowSummary>>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  run(name: string): Promise<WorkflowRunResult>;
  validateDraft(yaml: string): Promise<WorkflowValidateResult>;
  save(yaml: string, previousName?: string): Promise<WorkflowSaveResult>;
  getRun(name: string): Promise<WorkflowDetailResult | null>;
  resume(runId: string, reply: string): Promise<WorkflowRunResult>;
}

export function makeWorkflowsView(ctx: ViewContext): WorkflowsClientView {
  const { peer, requireServerProtocol } = ctx;
  return {
    list: () =>
      peer.request<ReadonlyArray<WorkflowSummary>>(RunnerMethod.WorkflowList),
    setEnabled: async (name, enabled) => {
      await peer.request(RunnerMethod.WorkflowSetEnabled, {
        name,
        enabled,
      });
    },
    run: (name) =>
      peer.request<WorkflowRunResult>(RunnerMethod.WorkflowRun, { name }),
    // Builder methods (protocol v4): forward to the runner so the desktop's
    // RemoteSession-backed visual builder can validate/save/load drafts.
    // Gated on the SERVER's reported version so a v4 client on a v3 runner
    // (a desktop whose JS hot-update outran its bundled CLI) gets a clear
    // "update the CLI" error instead of a raw method-not-found.
    validateDraft: async (yaml) => {
      requireServerProtocol(4, 'The workflows builder');
      return peer.request<WorkflowValidateResult>(RunnerMethod.WorkflowValidateDraft, {
        yaml,
      });
    },
    save: async (yaml, previousName) => {
      requireServerProtocol(4, 'Saving a workflow from the builder');
      return peer.request<WorkflowSaveResult>(RunnerMethod.WorkflowSave, {
        yaml,
        ...(previousName ? { previousName } : {}),
      });
    },
    getRun: async (name) => {
      requireServerProtocol(4, 'Loading a workflow into the builder');
      return peer.request<WorkflowDetailResult | null>(RunnerMethod.WorkflowGetRun, { name });
    },
    // Human-in-the-loop resume (protocol v5). Gated on the SERVER's reported
    // version so a v5 client attached to a v4 runner (a desktop whose JS
    // hot-update outran its bundled CLI) gets a clear "update the CLI" error
    // rather than a raw method-not-found.
    resume: async (runId, reply) => {
      requireServerProtocol(5, 'Resuming a paused workflow');
      return peer.request<WorkflowRunResult>(RunnerMethod.WorkflowResume, {
        runId,
        reply,
      });
    },
  };
}
