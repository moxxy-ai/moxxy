/**
 * Schedules sub-view of the Actions surface. Lists the runner's scheduled jobs
 * (cron / one-shot) from `scheduler.list` with their next fire time + last
 * result, and lets the user enable/disable or delete one. Content-only — the
 * Actions header (top switcher + sub-tabs) is owned by {@link ActionsPanel}.
 */

import { useScheduler } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';

function whenLabel(s: ScheduleSummary): string {
  if (s.cron) return `cron ${s.cron}${s.timeZone ? ` (${s.timeZone})` : ''}`;
  if (s.runAt) return `once @ ${new Date(s.runAt).toLocaleString()}`;
  return 'on demand';
}

function nextLabel(s: ScheduleSummary): string | null {
  if (!s.enabled) return null;
  if (s.nextFireAt) return `next ${new Date(s.nextFireAt).toLocaleString()}`;
  return null;
}

export function SchedulesPanel(): JSX.Element {
  const sched = useScheduler();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 0' }}>
        <Button variant="chip" onClick={() => void sched.refresh()} style={{ borderRadius: 9 }}>
          <Icon name="rotate" size={14} />
          Refresh
        </Button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {sched.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '0.45rem 0.65rem',
              border: '1px solid var(--color-pink)',
              background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
              borderRadius: 'var(--radius-block)',
              fontSize: '0.85rem',
            }}
          >
            {sched.error}
          </p>
        )}
        {sched.loading && sched.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : sched.list.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>
            No schedules on this runner. Give a workflow an <code>on.schedule.cron</code> trigger, or
            ask the agent to schedule a task.
          </p>
        ) : (
          <ul
            role="list"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
          >
            {sched.list.map((s) => (
              <li
                key={s.id}
                data-testid={`schedule-row-${s.id}`}
                style={{
                  padding: '0.65rem 0.85rem',
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-block)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: '0.5rem',
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>
                    {whenLabel(s)}
                    {s.source === 'workflow' && s.workflowName ? ` · workflow: ${s.workflowName}` : ''}
                    {nextLabel(s) ? ` · ${nextLabel(s)}` : ''}
                    {s.lastResult ? ` · last: ${s.lastResult}` : ''}
                  </div>
                </div>
                <Button
                  variant="chip"
                  onClick={() => void sched.setEnabled(s.id, !s.enabled)}
                  style={{ borderRadius: 9 }}
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button
                  variant="chip"
                  data-testid={`schedule-delete-${s.id}`}
                  onClick={() => void sched.deleteSchedule(s.id)}
                  style={{ borderRadius: 9 }}
                >
                  <Icon name="trash" size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
