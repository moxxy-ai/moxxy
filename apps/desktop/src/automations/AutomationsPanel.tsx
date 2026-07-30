import { useState } from 'react';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { SchedulesPanel } from '../apps/SchedulesPanel';
import { WebhooksPanel } from '../apps/WebhooksPanel';
import { useWorkflows } from '@moxxy/client-core';
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

const KINDS: ReadonlyArray<{ readonly id: Kind; readonly label: string }> = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'webhooks', label: 'Webhooks' },
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
  // Only workflows are counted here, and only because the count is already
  // fetched for the pane. Schedules and webhooks own their own fetches; showing
  // a count for one kind and a fabricated zero for the others would be worse than
  // showing none, so they show none.
  const wf = useWorkflows();
  const counts: Partial<Record<Kind, number>> = { workflows: wf.list.length };

  return (
    <IndexColumn title="automations">
      <div className="index-group">
        <span className="index-group__label">by kind</span>
      </div>
      {KINDS.map((k) => {
        const active = k.id === kind;
        const count = counts[k.id];
        return (
          <button
            key={k.id}
            type="button"
            className={active ? 'session-row' : 'session-row row-button'}
            data-testid={`automations-kind-${k.id}`}
            data-active={active}
            aria-current={active ? 'true' : undefined}
            onClick={() => onPick(k.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-8)',
              width: '100%',
              minHeight: 'var(--frame-row)',
              padding: '2px var(--space-6) 2px var(--space-8)',
              borderRadius: 'var(--radius-block)',
              background: active ? 'var(--color-card-bg)' : 'transparent',
              color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
              fontWeight: active ? 600 : 400,
              fontSize: 'var(--type-row)',
              textAlign: 'left',
            }}
          >
            <span className="led" data-state={active ? 'done' : undefined} aria-hidden />
            <span style={{ flex: 1, minWidth: 0 }}>{k.label}</span>
            {count !== undefined && (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 'var(--type-label)',
                  color: 'var(--color-text-dim)',
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
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
