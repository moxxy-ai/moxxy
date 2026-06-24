/**
 * Actions surface — the top-level tab that groups everything that *does* work
 * on a schedule or trigger: Workflows, Schedules and Webhooks. One chrome
 * header owns the top view switcher (Actions active) plus a sub-tab segmented
 * control; each sub-view renders content-only beneath it.
 */

import { useState } from 'react';
import { Segmented, ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { SchedulesPanel } from './SchedulesPanel';
import { WebhooksPanel } from './WebhooksPanel';

type ActionTab = 'workflows' | 'schedules' | 'webhooks';

const TABS: ReadonlyArray<{ readonly id: ActionTab; readonly label: string }> = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'webhooks', label: 'Webhooks' },
];

export function ActionsPanel({
  onView = () => undefined,
  disabledViews,
  disabledViewReason,
}: {
  readonly onView?: (v: View) => void;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledViewReason?: string;
}): JSX.Element {
  const [tab, setTab] = useState<ActionTab>('workflows');
  return (
    <>
      <ViewHeader>
        <ViewSwitcher
          view="actions"
          onView={onView}
          disabledViews={disabledViews}
          disabledReason={disabledViewReason}
        />
        <span style={{ width: 1, alignSelf: 'stretch', margin: '12px 4px', background: 'var(--color-card-border)' }} />
        <Segmented items={TABS} value={tab} onChange={setTab} testIdPrefix="actions-tab-" />
      </ViewHeader>
      {tab === 'workflows' && <WorkflowsPanel embedded onView={onView} />}
      {tab === 'schedules' && <SchedulesPanel />}
      {tab === 'webhooks' && <WebhooksPanel />}
    </>
  );
}
