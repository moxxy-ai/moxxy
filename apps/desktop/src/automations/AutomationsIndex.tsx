import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { useScheduler, useWebhooks, useWorkflows } from '@moxxy/client-core';
import { IndexColumn } from '../shell/IndexColumn';

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
              className="row-button index-group"
              style={{ cursor: 'pointer', borderRadius: 'var(--radius-block)' }}
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
              <span
                aria-hidden
                style={{
                  display: 'inline-flex',
                  flexShrink: 0,
                  transform: isFolded ? 'none' : 'rotate(90deg)',
                  transition: 'transform var(--motion-shift) ease',
                }}
              >
                <Icon name="chevron-right" size={12} />
              </span>
              <span
                className="index-group__label"
                style={group.id === kind ? { color: 'var(--color-text-muted)' } : undefined}
              >
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
                <button
                  key={`${group.id}:${item.id}`}
                  type="button"
                  data-testid={`automations-item-${item.id}`}
                  data-active={selected === `${group.id}:${item.id}`}
                  className={
                    selected === `${group.id}:${item.id}`
                      ? 'session-row'
                      : 'session-row row-button'
                  }
                  onClick={() => {
                    setSelected(`${group.id}:${item.id}`);
                    onPick(group.id);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-8)',
                    width: '100%',
                    minHeight: 'var(--frame-row)',
                    padding: '2px var(--space-6) 2px var(--space-24)',
                    borderRadius: 'var(--radius-block)',
                    background:
                      selected === `${group.id}:${item.id}` ? 'var(--color-card-bg)' : 'transparent',
                    color:
                      selected === `${group.id}:${item.id}`
                        ? 'var(--color-sidebar-text)'
                        : 'var(--color-sidebar-text-dim)',
                    fontWeight: selected === `${group.id}:${item.id}` ? 600 : 400,
                    fontSize: 'var(--type-row)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    className="led"
                    data-state={item.enabled ? 'done' : undefined}
                    aria-hidden
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </span>
                  {!item.enabled && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 'var(--type-label)',
                        color: 'var(--color-text-dim)',
                      }}
                    >
                      paused
                    </span>
                  )}
                </button>
              ))}
            {!isFolded && group.items.length === 0 && (
              <p
                style={{
                  margin: 0,
                  padding: '2px var(--space-6) var(--space-6) var(--space-24)',
                  fontSize: 'var(--type-label)',
                  color: 'var(--color-text-dim)',
                }}
              >
                none yet
              </p>
            )}
          </div>
        );
      })}
    </IndexColumn>
  );
}
