import {
  type Workflow,
  type WorkflowRunResult,
  type WorkflowRunStatus,
  type WorkflowStepResult,
  type WorkflowStepStatus,
} from '@moxxy/sdk';
import { type SerializedStepState } from '../run-store.js';
import {
  sinkOutput,
  type ExecutorContext,
  type StepRuntimeStatus,
  type StepState,
} from './context.js';

export function serializeStates(
  states: Map<string, StepState>,
): Record<string, SerializedStepState> {
  const out: Record<string, SerializedStepState> = {};
  for (const [id, st] of states) {
    out[id] = {
      status: st.status === 'pending' ? 'pending' : st.status,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    };
  }
  return out;
}

export function restoreStates(raw: Record<string, SerializedStepState>): Map<string, StepState> {
  const states = new Map<string, StepState>();
  for (const [id, st] of Object.entries(raw)) {
    states.set(id, {
      status: st.status as StepRuntimeStatus,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    });
  }
  return states;
}

export function buildStepResults(
  workflow: Workflow,
  states: Map<string, StepState>,
): WorkflowStepResult[] {
  return workflow.steps.map((step) => {
    const st = states.get(step.id)!;
    const status: WorkflowStepStatus =
      st.status === 'pending' ? 'skipped' : (st.status as WorkflowStepStatus);
    return {
      id: step.id,
      status,
      output: st.output,
      ...(st.error ? { error: st.error } : {}),
      startedAt: st.startedAt,
      endedAt: st.endedAt,
    };
  });
}

export function buildRunResult(
  ctx: ExecutorContext,
  status: WorkflowRunStatus,
  ok: boolean,
  extra?: Partial<WorkflowRunResult>,
): WorkflowRunResult {
  const output = status === 'completed' ? sinkOutput(ctx.workflow, ctx.states) : '';
  return {
    ok,
    status,
    steps: buildStepResults(ctx.workflow, ctx.states),
    output,
    ...extra,
  };
}
