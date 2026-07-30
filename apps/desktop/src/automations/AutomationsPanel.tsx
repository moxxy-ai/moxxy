import { useState } from 'react';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { SchedulesPanel } from '../apps/SchedulesPanel';
import { WebhooksPanel } from '../apps/WebhooksPanel';
import { IndexColumn } from '../shell/IndexColumn';
import { InstrumentBar } from '../shell/InstrumentBar';

/**
 * Automations: the things that fire themselves.
 *
 * Workflows, schedules and webhooks used to be chips inside Apps, which put two
 * unrelated families behind one destination — an installable app is something you
 * open, an automation is something that runs without you. They are one family
 * (a trigger, then work) and they get one place.
 *
 * The kind is picked in the INDEX COLUMN rather than from a row of chips in the
 * header, which is the whole point of the column: the rail says where you are, the
 * index says what is in here.
 */

type Kind = 'workflows' | 'schedules' | 'webhooks';

const KINDS: ReadonlyArray<{ readonly id: Kind; readonly label: string; readonly hint: string }> = [
  { id: 'workflows', label: 'Workflows', hint: 'A graph of steps' },
  { id: 'schedules', label: 'Schedules', hint: 'Fires on a clock' },
  { id: 'webhooks', label: 'Webhooks', hint: 'Fires on an event' },
];

const TITLE: Record<Kind, string> = {
  workflows: 'Workflows',
  schedules: 'Schedules',
  webhooks: 'Webhooks',
};

export function AutomationsIndex({
  kind,
  onPick,
}: {
  readonly kind: Kind;
  readonly onPick: (kind: Kind) => void;
}): JSX.Element | null {
  return (
    <IndexColumn title="automations">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          className={k.id === kind ? 'session-row' : 'session-row row-button'}
          data-testid={`automations-kind-${k.id}`}
          data-active={k.id === kind}
          aria-current={k.id === kind ? 'true' : undefined}
          onClick={() => onPick(k.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-8)',
            width: '100%',
            minHeight: 'var(--frame-row)',
            padding: '2px var(--space-6) 2px var(--space-8)',
            borderRadius: 'var(--radius-block)',
            background: k.id === kind ? 'var(--color-card-bg)' : 'transparent',
            color:
              k.id === kind ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
            fontWeight: k.id === kind ? 600 : 400,
            fontSize: 'var(--type-row)',
            textAlign: 'left',
          }}
        >
          <span className="led" aria-hidden />
          <span style={{ flex: 1, minWidth: 0 }}>{k.label}</span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 'var(--type-label)',
              color: 'var(--color-text-dim)',
            }}
          >
            {k.hint}
          </span>
        </button>
      ))}
    </IndexColumn>
  );
}

export function AutomationsPanel({ kind }: { readonly kind: Kind }): JSX.Element {
  return (
    <>
      <InstrumentBar crumbs={['Automations', TITLE[kind]]} />
      {kind === 'workflows' && <WorkflowsPanel embedded />}
      {kind === 'schedules' && <SchedulesPanel />}
      {kind === 'webhooks' && <WebhooksPanel />}
    </>
  );
}

/** The kind the Automations destination lands on. */
export function useAutomationsKind(): readonly [Kind, (k: Kind) => void] {
  const [kind, setKind] = useState<Kind>('workflows');
  return [kind, setKind];
}
