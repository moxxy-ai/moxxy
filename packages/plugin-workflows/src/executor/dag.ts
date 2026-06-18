import { defineWorkflowExecutor, type WorkflowExecutorDef } from '@moxxy/sdk';
import { runExecutor } from './scheduler.js';

export const DAG_EXECUTOR_NAME = 'dag';

// Public re-exports — every existing import of these from './dag.js' keeps
// working unchanged. The implementation now lives in focused sibling modules:
//   - context.ts      shared ExecutorContext seam + pure helpers
//   - state-serde.ts  checkpoint (de)serialization + result building
//   - steps.ts        per-step-kind execution (tool/prompt/skill/logic/loop/nested)
//   - scheduler.ts    the wave scheduler loop + run + resume orchestration
export { resumeWorkflowRun } from './scheduler.js';

export const dagExecutor: WorkflowExecutorDef = defineWorkflowExecutor({
  name: DAG_EXECUTOR_NAME,
  description:
    'DAG runner: steps with settled dependencies are scheduled in waves of up to `concurrency` ready steps, then executed sequentially within each wave (no overlap — `concurrency` caps the batch size drained per pass, not wall-clock latency).',
  run: runExecutor,
});
