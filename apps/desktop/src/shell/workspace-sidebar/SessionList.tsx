import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { DeskSession } from '@moxxy/desktop-ipc-contract';

/**
 * The ACTIVE desk's sessions, nested under its workspace row in the
 * rail. Mirrors the workspace rows' visual language at a smaller scale:
 * indented rows (a dot stands in for the monogram tile), active
 * highlight, unread dot, hover-only rename (✎) / remove (×)
 * affordances, and a dim "New session" row at the bottom.
 *
 * Purely presentational — the sidebar container owns the store calls
 * and the remove confirmation.
 */
export function SessionList({
  sessions,
  activeSessionId,
  unread,
  busy,
  onSelect,
  onCreate,
  onRename,
  onRemove,
}: {
  readonly sessions: ReadonlyArray<DeskSession>;
  readonly activeSessionId: string | null;
  readonly unread: ReadonlySet<string>;
  readonly busy?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onCreate: () => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onRemove: (session: DeskSession) => void;
}): JSX.Element {
  /** Session whose name is being edited inline; null = none. */
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  const commitRename = (): void => {
    if (!editing) return;
    const name = editing.draft.trim();
    const prev = sessions.find((s) => s.id === editing.id)?.name;
    setEditing(null);
    if (name && name !== prev) onRename(editing.id, name);
  };

  return (
    <ul
      role="list"
      aria-label="Sessions"
      style={{
        listStyle: 'none',
        margin: '2px 0 4px',
        padding: '0 0 0 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {sessions.map((s) => {
        const active = s.id === activeSessionId;
        return (
          <li key={s.id}>
            <div
              data-testid={`session-row-${s.id}`}
              data-active={active}
              onClick={() => onSelect(s.id)}
              className={active ? undefined : 'row-button'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 8px',
                borderRadius: 8,
                cursor: 'pointer',
                background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
                color: active
                  ? 'var(--color-sidebar-text)'
                  : 'var(--color-sidebar-text-dim)',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'currentColor',
                  opacity: active ? 0.9 : 0.45,
                  flexShrink: 0,
                }}
              />
              {editing?.id === s.id ? (
                <input
                  autoFocus
                  value={editing.draft}
                  aria-label={`rename session ${s.name}`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditing({ id: s.id, draft: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    padding: '1px 4px',
                    borderRadius: 6,
                    border: '1px solid var(--color-sidebar-text-dim)',
                    background: 'transparent',
                    color: 'var(--color-sidebar-text)',
                    outline: 'none',
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {s.name}
                </span>
              )}
              {unread.has(s.id) && (
                <span
                  aria-label="unread activity"
                  title="New activity in this session"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    flexShrink: 0,
                    boxShadow: '0 0 8px color-mix(in srgb, var(--color-primary) 60%, transparent)',
                  }}
                />
              )}
              <button
                type="button"
                aria-label={`rename session ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing({ id: s.id, draft: s.name });
                }}
                style={{
                  color: 'var(--color-sidebar-text-dim)',
                  opacity: active ? 0.9 : 0.55,
                  padding: '0 2px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Icon name="pencil" size={11} />
              </button>
              <button
                type="button"
                aria-label={`remove session ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(s);
                }}
                style={{
                  color: 'var(--color-sidebar-text-dim)',
                  opacity: active ? 1 : 0.55,
                  padding: '0 2px',
                  fontSize: 13,
                }}
              >
                ×
              </button>
            </div>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          data-testid="session-new"
          onClick={onCreate}
          disabled={busy}
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            fontSize: 12.5,
            color: 'var(--color-sidebar-text-dim)',
            borderRadius: 8,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <span
            style={{
              width: 5,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="plus" size={12} />
          </span>
          New session
        </button>
      </li>
    </ul>
  );
}
