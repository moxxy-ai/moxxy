import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';

type History = Pick<ScheduleSummary, 'source' | 'lastResult' | 'lastSkippedAt' | 'lastSkipReason'> &
  Partial<Pick<ScheduleSummary, 'workflowName'>>;

export function ScheduleHistory({ schedule }: { schedule: History }): JSX.Element {
  return <small>
    {schedule.source === 'workflow' && schedule.workflowName
      ? `workflow · ${schedule.workflowName}` : schedule.source}
    {schedule.lastResult ? ` · last ${schedule.lastResult}` : ''}
    {schedule.lastSkippedAt != null && <span style={{ display: 'block' }}>
      Skipped occurrence · {new Date(schedule.lastSkippedAt).toLocaleString()}
      {schedule.lastSkipReason ? ` · ${schedule.lastSkipReason}` : ''}
    </span>}
  </small>;
}
