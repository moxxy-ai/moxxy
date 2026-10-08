import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { useScheduler, useWebhooks, useWorkflows } from '@moxxy/client-core';
import { IndexColumn, IndexEmpty, IndexRow } from '../shell/IndexColumn';

/**
 * The Automations index: collapsible groups by kind, with the actual automations
 * as rows underneath — the same shape the Runs column uses for workspaces and
 * their sessions.
 *
 * It listed three kinds and stopped there, so the column told you nothing about
 * what was IN them; you had to switch panes to find out whether a kind was even
 * populated. A group header now carries its count and folds, and the things
 * themselves are what you click.
 *
 * A group's LED reports the one state these payloads actually carry: whether
 * anything in it is disabled. Run outcomes are not in the IPC surface at all (see
 * the note in WorkflowsPanel), so no row claims to know how it last went.
 */

export type Kind = 'workflows' | 'schedules' | 'webhooks';

interface Item {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
}

export function AutomationsIndex({
  kind,
  onPick,
}: {
  readonly kind: Kind;
  readonly onPick: (kind: Kind) => void;
}): JSX.Element | null {
  const wf = useWorkflows();
  const sched = useScheduler();
  const hooks = useWebhooks();
  // Folded state is local to the column and starts open: a fresh column that
  // hides everything behind three chevrons answers no question at all.
  const [folded, setFolded] = useState<ReadonlySet<Kind>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const groups: ReadonlyArray<{ readonly id: Kind; readonly label: string; readonly items: ReadonlyArray<Item> }> = [
    {
      id: 'workflows',
      label: 'Workflows',
      items: wf.list.map((w) => ({ id: w.name, name: w.name, enabled: w.enabled })),
    },
    {
      id: 'schedules',
      label: 'Schedules',
      items: sched.list.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled })),
    },
    {
      id: 'webhooks',
      label: 'Webhooks',
      items: hooks.list.map((h) => ({ id: h.id, name: h.name, enabled: h.enabled })),
    },
  ];

  const toggle = (id: Kind): void =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <IndexColumn title="automations">
      {groups.map((group) => {
        const isFolded = folded.has(group.id);
        const anyDisabled = group.items.some((i) => !i.enabled);
        return (
          <div key={group.id}>
            <div
              role="button"
              tabIndex={0}
              data-testid={`automations-group-${group.id}`}
              aria-expanded={!isFolded}
              aria-label={`${isFolded ? 'expand' : 'collapse'} ${group.label}`}
              className="index-group index-group--fold"
              onClick={() => {
                toggle(group.id);
                onPick(group.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(group.id);
                  onPick(group.id);
                }
              }}
            >
              <span className="index-group__chevron" data-open={!isFolded} aria-hidden>
                <Icon name="chevron-right" size={12} />
              </span>
              <span className="index-group__label" data-current={group.id === kind || undefined}>
                {group.label}
              </span>
              {/* Folded, the group carries its children's state the way a folded
               *  workspace carries their unread — otherwise collapsing hides the
               *  one thing worth noticing. */}
              {isFolded && anyDisabled && <span className="led" data-state="awaiting" aria-hidden />}
              <span className="index-group__count">{group.items.length}</span>
            </div>
            {!isFolded &&
              group.items.map((item) => (
                <IndexRow
                  key={`${group.id}:${item.id}`}
                  nested
                  label={item.name}
                  active={selected === `${group.id}:${item.id}`}
                  led={item.enabled ? 'done' : 'off'}
                  note={item.enabled ? undefined : 'Paused'}
                  testId={`automations-item-${item.id}`}
                  onPick={() => {
                    setSelected(`${group.id}:${item.id}`);
                    onPick(group.id);
                  }}
                />
              ))}
            {!isFolded && group.items.length === 0 && (
<IndexEmpty>None yet</IndexEmpty>
            )}
          </div>
        );
      })}
    </IndexColumn>
  );
}
