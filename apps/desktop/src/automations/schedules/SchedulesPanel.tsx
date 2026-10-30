/**
 * Automations → Schedules. The prompts Moxxy runs by itself, as cards in the
 * Settings look: the person's own schedules first, then the ones a workflow or
 * a skill keeps in step. New schedule opens a form; nothing here needs a cron.
 */

import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { Button, ConfirmModal, Icon, Skeleton } from '@moxxy/desktop-ui';
import { InstrumentBar } from '../../shell/InstrumentBar';
import { CardGroup } from '../../settings/settings-primitives';
import { TabHeader } from '../../settings/TabHeader';
import { NewScheduleModal } from './NewScheduleModal';
import { ScheduleRow } from './ScheduleRow';
import { scheduleRowView } from './schedule-labels';
import { useSchedulesPanel, type SchedulesPanelState } from './useSchedulesPanel';

export function SchedulesPanel(): JSX.Element {
  const panel = useSchedulesPanel();
  const { scheduler } = panel;

  return (
    <>
      <InstrumentBar crumbs={['Automations', 'Schedules']}>
        <button
          type="button"
          className="btn-box tip"
          data-tip="Refresh"
          data-tip-side="bottom"
          aria-label="Refresh schedules"
          onClick={() => void scheduler.refresh()}
        >
          <Icon name="rotate" size={14} />
        </button>
        <Button variant="cta" onClick={panel.openCreate} style={{ gap: 7 }}>
          <Icon name="plus" size={14} />
          New schedule
        </Button>
      </InstrumentBar>
      <div className="sched-pane">
        <TabHeader
          title="Schedules"
          {...(scheduler.list.length > 0 ? { count: scheduler.list.length } : {})}
          description={
            scheduler.list.length > 0
              ? `Prompts Moxxy runs by itself. Next run: ${panel.nextRun}.`
              : 'Prompts Moxxy runs by itself, at the times you set.'
          }
        />
        {scheduler.error && (
          <p className="sched-pane__error" role="alert">
            {scheduler.error}
          </p>
        )}
        <ScheduleList panel={panel} />
      </div>
      {panel.creating && (
        <NewScheduleModal
          create={scheduler.create}
          targetSessionId={panel.currentChatId}
          onClose={panel.closeCreate}
        />
      )}
      {panel.pendingDelete && (
        <ConfirmModal
          title="Delete schedule?"
          message={`Delete “${panel.pendingDelete.name}”? It will not run again. Its past results stay in the inbox.`}
          confirmLabel="Delete"
          destructive
          onCancel={panel.cancelDelete}
          onConfirm={panel.confirmDelete}
        />
      )}
    </>
  );
}

function ScheduleList({ panel }: { readonly panel: SchedulesPanelState }): JSX.Element {
  const { scheduler } = panel;
  if (scheduler.loading && scheduler.list.length === 0) {
    return (
      <div className="sched-pane__loading">
        <Skeleton.Card />
        <Skeleton.Card />
      </div>
    );
  }
  if (scheduler.list.length === 0) {
    return (
      <div className="sched-empty">
        <Icon name="clock" size={22} />
        <p className="sched-empty__title">No schedules yet</p>
        <p className="sched-empty__text">
          Have Moxxy do something at a set time: every morning, every 30 minutes, or once next Friday.
        </p>
        <Button variant="cta" onClick={panel.openCreate} style={{ gap: 7 }}>
          <Icon name="plus" size={14} />
          Create a schedule
        </Button>
      </div>
    );
  }
  const now = Date.now();
  const rows = (list: ReadonlyArray<ScheduleSummary>) =>
    list.map((s) => (
      <ScheduleRow
        key={s.id}
        schedule={s}
        view={scheduleRowView(s, now)}
        onToggle={(enabled) => void scheduler.setEnabled(s.id, enabled)}
        onTargetSession={(sessionId) => void scheduler.setTargetSession(s.id, sessionId)}
        onDelete={() => panel.askDelete(s)}
      />
    ));
  return (
    <div className="card-groups">
      {panel.yours.length > 0 && (
        <CardGroup id="schedules-yours" title="Yours" count={panel.yours.length}>
          {rows(panel.yours)}
        </CardGroup>
      )}
      {panel.linked.length > 0 && (
        <CardGroup id="schedules-linked" title="From workflows and skills" count={panel.linked.length}>
          {rows(panel.linked)}
        </CardGroup>
      )}
    </div>
  );
}
