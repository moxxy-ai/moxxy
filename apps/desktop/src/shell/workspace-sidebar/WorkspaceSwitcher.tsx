import { useEffect, useRef, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { Desk } from '@moxxy/desktop-ipc-contract';

/**
 * Slack/Linear-style workspace switcher: a roomy card showing the ACTIVE
 * workspace (monogram tile, name that may wrap to two lines, session
 * count) that opens a dropdown listing every workspace plus a "New
 * workspace" footer. Replaces the old per-workspace rail rows so long
 * names stay readable and the rail's vertical space goes to sessions.
 *
 * Purely presentational — the sidebar container owns the store calls and
 * the remove confirmation.
 */
export function WorkspaceSwitcher({
  desks,
  activeDeskId,
  unreadDeskIds,
  sessionCount,
  busy,
  onSelect,
  onRemove,
  onNewWorkspace,
}: {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeDeskId: string | null;
  /** Desk ids with unread activity in any of their sessions. */
  readonly unreadDeskIds: ReadonlySet<string>;
  /** Session count of the ACTIVE workspace, shown under its name. */
  readonly sessionCount: number;
  /** True while the new-workspace folder picker is open. */
  readonly busy?: boolean;
  readonly onSelect: (id: string) => void;
  readonly onRemove: (desk: Desk) => void;
  readonly onNewWorkspace: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = desks.find((d) => d.id === activeDeskId) ?? null;

  // Close on outside-click or Escape — same pattern as the composer's
  // OverflowMenu (document listeners scoped to the open state).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="workspace-switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        title={active?.name}
        onClick={() => setOpen((o) => !o)}
        className="row-button"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          padding: '9px 10px',
          borderRadius: 12,
          background: 'var(--color-sidebar-bg-active)',
          border: '1px solid var(--color-sidebar-border)',
          color: 'var(--color-sidebar-text)',
        }}
      >
        <Monogram name={active?.name ?? '?'} color={active?.color ?? 'var(--color-primary)'} size={34} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: 13.5,
              fontWeight: 600,
              lineHeight: 1.25,
              wordBreak: 'break-word',
            }}
          >
            {active?.name ?? 'Choose a workspace'}
          </span>
          <span
            style={{
              display: 'block',
              marginTop: 1,
              fontSize: 11.5,
              fontWeight: 400,
              color: 'var(--color-sidebar-text-dim)',
            }}
          >
            {active
              ? `${sessionCount} session${sessionCount === 1 ? '' : 's'}`
              : `${desks.length} workspace${desks.length === 1 ? '' : 's'}`}
          </span>
        </span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            color: 'var(--color-sidebar-text-dim)',
            // The icon set has no chevron-down — rotate the right one.
            transform: 'rotate(90deg)',
            flexShrink: 0,
          }}
        >
          <Icon name="chevron-right" size={15} />
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: 4,
            background: 'var(--color-sidebar-bg)',
            border: '1px solid var(--color-sidebar-border)',
            borderRadius: 12,
            boxShadow: '0 18px 40px -18px rgba(0, 0, 0, 0.45)',
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          {desks.map((d) => (
            <DeskMenuRow
              key={d.id}
              desk={d}
              current={d.id === activeDeskId}
              unread={unreadDeskIds.has(d.id)}
              onSelect={() => {
                setOpen(false);
                onSelect(d.id);
              }}
              onRemove={() => {
                setOpen(false);
                onRemove(d);
              }}
            />
          ))}
          <button
            type="button"
            role="menuitem"
            data-testid="desk-new"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onNewWorkspace();
            }}
            className="row-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              marginTop: 2,
              borderTop: '1px solid var(--color-sidebar-border)',
              borderRadius: '0 0 8px 8px',
              fontSize: 13,
              color: 'var(--color-sidebar-text-dim)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <span
              style={{
                width: 26,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="plus" size={15} />
            </span>
            {busy ? 'Picking folder…' : 'New workspace'}
          </button>
        </div>
      )}
    </div>
  );
}

/** One workspace entry inside the dropdown. Hover (or keyboard focus
 *  within the row) reveals the remove ×; clicking it never selects. */
function DeskMenuRow({
  desk,
  current,
  unread,
  onSelect,
  onRemove,
}: {
  readonly desk: Desk;
  readonly current: boolean;
  readonly unread: boolean;
  readonly onSelect: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [hot, setHot] = useState(false);
  return (
    <div
      role="menuitem"
      data-testid={`desk-row-${desk.id}`}
      data-active={current}
      onClick={onSelect}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocusCapture={() => setHot(true)}
      onBlurCapture={() => setHot(false)}
      className={current ? undefined : 'row-button'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 8px',
        borderRadius: 8,
        cursor: 'pointer',
        background: current ? 'var(--color-sidebar-bg-active)' : 'transparent',
        color: current ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
        fontWeight: current ? 600 : 500,
      }}
    >
      <Monogram name={desk.name} color={desk.color} size={26} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={desk.name}
      >
        {desk.name}
      </span>
      {unread && (
        <span
          aria-label="unread activity"
          title="New activity in this workspace"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-primary)',
            flexShrink: 0,
            boxShadow: '0 0 8px color-mix(in srgb, var(--color-primary) 60%, transparent)',
          }}
        />
      )}
      {current && (
        <span
          aria-label="current workspace"
          style={{ display: 'inline-flex', color: 'var(--color-primary)', flexShrink: 0 }}
        >
          <Icon name="check" size={14} />
        </span>
      )}
      <button
        type="button"
        aria-label={`remove workspace ${desk.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          color: 'var(--color-sidebar-text-dim)',
          opacity: hot ? 0.9 : 0,
          padding: '0 4px',
          fontSize: 14,
          flexShrink: 0,
          transition: 'opacity 120ms ease',
        }}
      >
        ×
      </button>
    </div>
  );
}

/** Coloured monogram tile — the existing desk.color treatment. */
function Monogram({
  name,
  color,
  size,
}: {
  readonly name: string;
  readonly color: string;
  readonly size: number;
}): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        // 12% colour wash behind the letter; color-mix keeps it sane on
        // both themes (desk.color is an arbitrary hex from the store).
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.44),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
