/**
 * Schedules sub-view of the Apps surface. Lists the runner's scheduled jobs
 * (cron / one-shot) from `scheduler.list` with their next fire time + last
 * result, and lets the user enable/disable or delete one. Content-only — the
 * Apps header (top switcher + sub-tabs) is owned by {@link AppsPanel}.
 */

import { useScheduler } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { StateToggle } from '../components/StateToggle';
import { TargetSessionPicker } from './TargetSessionPicker';
import { InstrumentBar } from '../shell/InstrumentBar';
import { ScheduleHistory } from './ScheduleHistory';

function whenLabel(s: ScheduleSummary): string {
  if (s.cron) return `cron ${s.cron}${s.timeZone ? ` (${s.timeZone})` : ''}`;
  if (s.runAt) return `once @ ${new Date(s.runAt).toLocaleString()}`;
  return 'on demand';
}

/** The soonest upcoming fire across all enabled schedules, or nothing when none
 *  is pending. Measured from `nextFireAt`, which the scheduler already reports. */
function nextFireSummary(list: ReadonlyArray<ScheduleSummary>): string {
  const times = list
    .filter((s) => s.enabled && s.nextFireAt !== null)
    .map((s) => s.nextFireAt as number)
    .sort((a, b) => a - b);
  const soonest = times[0];
  if (soonest === undefined) return 'None pending';
  const mins = Math.round((soonest - Date.now()) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `in ${hours}h ${mins % 60}m` : `in ${Math.floor(hours / 24)}d`;
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
          padding: 'var(--space-20) var(--space-32)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-16)',
        }}
      >
        {sched.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 'var(--space-6) var(--space-8)',
              border: '1px solid var(--color-red-border)',
              background: 'var(--color-red-wash)',
              borderRadius: 'var(--radius-block)',
              fontSize: 'var(--type-row)',
            }}
          >
            {sched.error}
          </p>
        )}
        {sched.loading && sched.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : sched.list.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>
            No schedules on this runner. Give a workflow an <code>on.schedule.cron</code> trigger, or
            ask the agent to schedule a task.
          </p>
        ) : (
          <>
            {/* Schedules DO carry a next fire and a last result, unlike workflows —
                so these tiles are measured rather than omitted. */}
            <div className="kpi" style={{ marginBottom: 'var(--space-16)' }}>
              <div className="kpi__c">
                <span className="kpi__k">Scheduled</span>
                <span className="kpi__v">{sched.list.length}</span>
              </div>
              <div className="kpi__c">
                <span className="kpi__k">Paused</span>
                <span
                  className="kpi__v"
                  data-tone={sched.list.some((s) => !s.enabled) ? 'caution' : undefined}
                >
                  {sched.list.filter((s) => !s.enabled).length}
                </span>
              </div>
              <div className="kpi__c">
                <span className="kpi__k">Failing</span>
                <span
                  className="kpi__v"
                  data-tone={
                    sched.list.some((s) => s.lastResult === 'error') ? 'caution' : undefined
                  }
                >
                  {sched.list.filter((s) => s.lastResult === 'error').length}
                </span>
              </div>
              <div className="kpi__c">
                <span className="kpi__k">Next fire</span>
                <span className="kpi__v kpi__v--text">{nextFireSummary(sched.list)}</span>
              </div>
            </div>
            <div className="data-table data-table--sched" role="table" aria-label="Schedules">
              <div className="data-row data-row--head" role="row">
                <span />
                <span role="columnheader">Schedule</span>
                <span role="columnheader">When</span>
                <span role="columnheader">Runs in</span>
                <span role="columnheader">State</span>
              </div>
              {sched.list.map((s) => (
                <div
                  key={s.id}
                  className="data-row"
                  role="row"
                  data-testid={`schedule-row-${s.id}`}
                >
                  <span
                    className="led"
                    data-state={
                      s.lastResult === 'error' ? 'failed' : s.enabled ? 'done' : undefined
                    }
                    aria-hidden
                  />
                  <span className="data-row__name" role="cell">
                    {s.name}
                    <ScheduleHistory schedule={s} />
                  </span>
                  <span className="data-row__meta" role="cell">
                    {whenLabel(s)}
                    {nextLabel(s) ? ` · ${nextLabel(s)}` : ''}
                  </span>
                  <span role="cell">
                    {s.source === 'manual' ? (
                      <TargetSessionPicker
                        label=""
                        value={s.targetSessionId ?? null}
                        valueName={s.targetSessionName ?? null}
                        onChange={(sid) => void sched.setTargetSession(s.id, sid)}
                      />
                    ) : (
                      // Workflow/skill-driven rows have their owner re-stamped on
                      // every sync from their source, so reassigning here would not
                      // stick — read-only, pointing at where it IS changed.
                      <span className="data-row__meta">
                        {s.targetSessionName ?? 'Any session'}
                      </span>
                    )}
                  </span>
                  <span role="cell">
                    <StateToggle
                      enabled={s.enabled}
                      name={s.name}
                      onToggle={(next) => void sched.setEnabled(s.id, next)}
                    />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
