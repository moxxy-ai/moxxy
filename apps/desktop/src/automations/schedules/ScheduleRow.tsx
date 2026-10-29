/**
 * One schedule as a card, drawn like a provider in Settings: a tile, the name
 * with its state, what sets it off in words, then its window, next and last
 * run. Where it runs, the On / Paused chip and Delete sit on the right.
 */

import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { Icon, IconButton } from '@moxxy/desktop-ui';
import { StateToggle } from '../../components/StateToggle';
import { TargetSessionPicker } from '../../apps/TargetSessionPicker';
import { Row, Tile } from '../../settings/settings-primitives';
import type { ScheduleRowView } from './schedule-labels';

export function ScheduleRow({
  schedule,
  view,
  onToggle,
  onTargetSession,
  onDelete,
}: {
  readonly schedule: ScheduleSummary;
  readonly view: ScheduleRowView;
  readonly onToggle: (enabled: boolean) => void;
  readonly onTargetSession: (sessionId: string | null) => void;
  readonly onDelete: () => void;
}): JSX.Element {
  // A workflow's or a skill's schedule is rewritten from its source on every
  // sync, so a change made here would not stick: it is read-only.
  const own = schedule.source === 'manual';
  return (
    <Row
      testId={`schedule-row-${schedule.id}`}
      tile={
        <Tile bg="var(--color-input-soft)" fg="var(--color-text-muted)">
          <Icon name={schedule.cron ? 'rotate' : 'clock'} size={17} />
        </Tile>
      }
      title={schedule.name}
      badges={
        view.failing ? (
          <span className="tag" data-tone="bad">
            Failing
          </span>
        ) : null
      }
      subtitle={view.trigger}
      below={
        <div className="sched-row__more" title={view.full}>
          {view.detail && <span>{view.detail}</span>}
          {view.skipped && <span>{view.skipped}</span>}
          {view.origin && <span>{view.origin}</span>}
        </div>
      }
      trailing={
        <div className="sched-row__actions">
          {own ? (
            <div className="sched-row__picker">
              <TargetSessionPicker
                label=""
                value={schedule.targetSessionId ?? null}
                valueName={schedule.targetSessionName ?? null}
                onChange={onTargetSession}
              />
            </div>
          ) : (
            <span className="sched-row__where">{schedule.targetSessionName ?? 'Any session'}</span>
          )}
          <StateToggle enabled={schedule.enabled} name={schedule.name} onToggle={onToggle} />
          {own && (
            <IconButton size={26} radius={7} aria-label={`Delete ${schedule.name}`} data-tip="Delete" onClick={onDelete}>
              <Icon name="x" size={14} />
            </IconButton>
          )}
        </div>
      }
    />
  );
}
