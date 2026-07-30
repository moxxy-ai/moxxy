/**
 * Schedules sub-view of the Apps surface. Lists the runner's scheduled jobs
 * (cron / one-shot) from `scheduler.list` with their next fire time + last
 * result, and lets the user enable/disable or delete one. Content-only — the
 * Apps header (top switcher + sub-tabs) is owned by {@link AppsPanel}.
 */

import { useScheduler } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { TargetSessionPicker } from './TargetSessionPicker';
import { InstrumentBar } from '../shell/InstrumentBar';

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
      <InstrumentBar crumbs={['Automations', 'Schedules']}>
        <button
          type="button"
          className="btn-box tip"
          data-tip="Refresh"
          data-tip-side="bottom"
          aria-label="Refresh schedules"
          onClick={() => void sched.refresh()}
        >
          <Icon name="rotate" size={14} />
        </button>
      </InstrumentBar>
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
              fontSize: 'var(--type-row)',
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
                  <div style={{ fontWeight: 600, fontSize: 'var(--type-row)' }}>{s.name}</div>
                  <div className="mono" style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
                    {whenLabel(s)}
                    {s.source === 'workflow' && s.workflowName ? ` · workflow: ${s.workflowName}` : ''}
                    {nextLabel(s) ? ` · ${nextLabel(s)}` : ''}
                    {s.lastResult ? ` · last: ${s.lastResult}` : ''}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {s.source === 'manual' ? (
                      <TargetSessionPicker
                        label="Runs in"
                        value={s.targetSessionId ?? null}
                        valueName={s.targetSessionName ?? null}
                        onChange={(sid) => void sched.setTargetSession(s.id, sid)}
                      />
                    ) : (
                      // workflow/skill-driven rows have their owner re-stamped on every
                      // sync from their source, so reassigning here wouldn't stick —
                      // show it read-only and point at where to change it.
                      <span style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
                        Runs in: {s.targetSessionName ?? 'any session'}
                        {s.source === 'workflow' ? ' (set on the workflow)' : ''}
                      </span>
                    )}
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
                  <Icon name="x" size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
