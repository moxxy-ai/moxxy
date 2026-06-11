import { useEffect, useRef, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { DeskSession } from '@moxxy/desktop-ipc-contract';
import { SectionHeader } from './SectionHeader';

/**
 * The ACTIVE workspace's sessions as a flat, full-width list under a
 * "Sessions" header. Rows are roomier than the old nested tree (~33px,
 * 13px names with single-line ellipsis); the active row carries the
 * highlight pill. Rename/Delete hide behind a hover-only ⋯ overflow
 * menu (always visible on the active row) instead of the old
 * always-visible ✎/× icons. The header's [+] creates a session.
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
    <div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <SectionHeader title="Sessions" style={{ flex: 1, padding: '8px 10px 6px 10px' }} />
        <button
          type="button"
          data-testid="session-new"
          aria-label="new session"
          title="New session"
          onClick={onCreate}
          disabled={busy}
          className="row-button"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 7,
            color: 'var(--color-sidebar-text-dim)',
            opacity: busy ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ul
        role="list"
        aria-label="Sessions"
        style={{
          listStyle: 'none',
          margin: '0 0 4px',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeSessionId}
            unread={unread.has(s.id)}
            editing={editing?.id === s.id ? editing.draft : null}
            onSelect={() => onSelect(s.id)}
            onStartRename={() => setEditing({ id: s.id, draft: s.name })}
            onDraft={(draft) => setEditing({ id: s.id, draft })}
            onCommitRename={commitRename}
            onCancelRename={() => setEditing(null)}
            onRemove={() => onRemove(s)}
          />
        ))}
      </ul>
    </div>
  );
}

/** One flat session row. The ⋯ actions trigger fades in on hover or
 *  focus-within and stays visible on the active row / while its menu
 *  is open. */
function SessionRow({
  session: s,
  active,
  unread,
  editing,
  onSelect,
  onStartRename,
  onDraft,
  onCommitRename,
  onCancelRename,
  onRemove,
}: {
  readonly session: DeskSession;
  readonly active: boolean;
  readonly unread: boolean;
  /** Current rename draft, or null when this row isn't being edited. */
  readonly editing: string | null;
  readonly onSelect: () => void;
  readonly onStartRename: () => void;
  readonly onDraft: (draft: string) => void;
  readonly onCommitRename: () => void;
  readonly onCancelRename: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [hot, setHot] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = hot || active || menuOpen;

  return (
    <li>
      <div
        data-testid={`session-row-${s.id}`}
        data-active={active}
        onClick={onSelect}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocusCapture={() => setHot(true)}
        onBlurCapture={() => setHot(false)}
        className={active ? undefined : 'row-button'}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 33,
          padding: '4px 4px 4px 10px',
          borderRadius: 8,
          cursor: 'pointer',
          background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
          color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
          fontWeight: active ? 600 : 400,
        }}
      >
        {editing !== null ? (
          <input
            autoFocus
            value={editing}
            aria-label={`rename session ${s.name}`}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              padding: '2px 4px',
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
              minWidth: 0,
              fontSize: 13,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={s.name}
          >
            {s.name}
          </span>
        )}
        {unread && (
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
        <SessionRowMenu
          sessionName={s.name}
          visible={showActions}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRename={onStartRename}
          onDelete={onRemove}
        />
      </div>
    </li>
  );
}

/** The hover-only ⋯ trigger + its tiny Rename/Delete popover. A local
 *  sibling of the chat composer's OverflowMenu (not imported — shell
 *  stays decoupled from chat components). Closes on outside-click,
 *  Escape, or item selection. */
function SessionRowMenu({
  sessionName,
  visible,
  open,
  onOpenChange,
  onRename,
  onDelete,
}: {
  readonly sessionName: string;
  readonly visible: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const item: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '7px 10px',
    fontSize: 12.5,
    fontWeight: 500,
    textAlign: 'left',
    borderRadius: 7,
    cursor: 'pointer',
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`session actions ${sessionName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 7,
          color: 'var(--color-sidebar-text-dim)',
          opacity: visible ? 0.9 : 0,
          background: open ? 'var(--color-sidebar-bg-hover)' : 'transparent',
          transition: 'opacity 120ms ease',
        }}
      >
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`session actions ${sessionName}`}
          // A click inside the popover must not bubble to the row (which
          // would select the session under the menu).
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 40,
            minWidth: 132,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            padding: 4,
            background: 'var(--color-sidebar-bg)',
            border: '1px solid var(--color-sidebar-border)',
            borderRadius: 10,
            boxShadow: '0 14px 32px -16px rgba(0, 0, 0, 0.45)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-label={`rename session ${sessionName}`}
            className="row-button"
            onClick={() => {
              onOpenChange(false);
              onRename();
            }}
            style={{ ...item, color: 'var(--color-sidebar-text)' }}
          >
            <Icon name="pencil" size={13} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label={`remove session ${sessionName}`}
            className="row-button"
            onClick={() => {
              onOpenChange(false);
              onDelete();
            }}
            style={{ ...item, color: 'var(--color-red-text)' }}
          >
            <Icon name="x" size={13} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}
