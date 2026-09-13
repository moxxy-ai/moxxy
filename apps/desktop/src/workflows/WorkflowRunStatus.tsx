import type { WorkflowRun } from '@moxxy/desktop-ipc-contract';

export function WorkflowRunStatus({ result }: { result: Pick<WorkflowRun, 'status' | 'ok'> }) {
  const label = result.status === 'cancelled' ? 'Stopped'
    : result.status === 'paused' ? 'Awaiting input'
    : result.ok ? 'Completed' : 'Failed';
  return <span>{label}</span>;
}
