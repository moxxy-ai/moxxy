import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@moxxy/desktop-ui';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { SectionHeader } from './SectionHeader';
import { useMenuKeyboard } from '../useMenuKeyboard';

/**
 * The whole workspace rail as one tree: every workspace is a collapsible
 * FOLDER row, its sessions nested beneath it. Replaces the old
 * active-desk-only pair (WorkspaceSwitcher card + flat SessionList).
 *
 *   WORKSPACES                                 [+]  ← new workspace
 *   ▾ ▣ blocky                              [+] ⋯   ← toggle / new session / menu
 *       Fix the sign-in bug                          ← session (first-prompt title)
 *       Redesign the sidebar          ●              ← unread dot
 *   ▸ ▣ website                       ●     [+] ⋯   ← collapsed: dot rolls up
 *
 * Interaction contract:
 *  - clicking a folder row (or its chevron) toggles collapse — switching
 *    workspaces happens by picking one of its SESSIONS, the routing unit;
 *  - [+] on a folder row creates a session IN that workspace;
 *  - ⋯ menus carry Rename/Remove for both row kinds and delegate the
 *    actual modal/persistence flow to the sidebar container;
 *  - row actions ([+]/⋯) are hover-only and OVERLAY the right edge of the
 *    name (gradient fade) instead of reserving width — names get the full
 *    row when idle ({@link ActionsOverlay});
 *  - the active desk's active session is the single highlighted row.
 *
 * Purely presentational — the sidebar container owns the stores, the
 * collapse state, and the action modals.
 */
export function WorkspaceTree({
  desks,
  activeDeskId,
  activeSessionId,
  unread,
  collapsed,
  busyDeskId,
  newWorkspaceBusy,
  onToggleCollapse,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onRemoveSession,
  onRenameWorkspace,
  onRemoveWorkspace,
  onNewWorkspace,
}: {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeDeskId: string | null;
  /** The active desk's foreground session — the one highlighted row. */
  readonly activeSessionId: string | null;
  /** Session ids carrying unread activity. */
  readonly unread: ReadonlySet<string>;
  /** Desk ids whose folder is collapsed. */
  readonly collapsed: ReadonlySet<string>;
  /** Desk with a session-create in flight (its [+] disables). */
  readonly busyDeskId: string | null;
  readonly newWorkspaceBusy?: boolean;
  readonly onToggleCollapse: (deskId: string) => void;
  readonly onSelectSession: (id: string) => void;
  readonly onCreateSession: (deskId: string) => void;
  readonly onRenameSession: (session: DeskSession) => void;
  readonly onRemoveSession: (session: DeskSession) => void;
  readonly onRenameWorkspace: (desk: Desk) => void;
  readonly onRemoveWorkspace: (desk: Desk) => void;
  readonly onNewWorkspace: () => void;
}): JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <SectionHeader title="Workspaces" style={{ flex: 1, padding: '8px 10px 6px 10px' }} />
        <button
          type="button"
          data-testid="workspace-new"
          aria-label="new workspace"
          title="New workspace"
          onClick={onNewWorkspace}
          disabled={newWorkspaceBusy}
          className="row-button"
          style={{
            ...iconButtonStyle,
            opacity: newWorkspaceBusy ? 0.5 : 1,
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ul
        role="tree"
        aria-label="Workspaces"
        style={{
          listStyle: 'none',
          margin: '0 0 4px',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {desks.map((desk) => {
          const isCollapsed = collapsed.has(desk.id);
          const hasUnread =
            desk.sessions.some((s) => unread.has(s.id)) || unread.has(desk.id);
          return (
            <li key={desk.id} role="treeitem" aria-expanded={!isCollapsed}>
              <FolderRow
                desk={desk}
                active={desk.id === activeDeskId}
                collapsed={isCollapsed}
                unread={isCollapsed && hasUnread}
                busy={busyDeskId === desk.id}
                onToggle={() => onToggleCollapse(desk.id)}
                onCreateSession={() => onCreateSession(desk.id)}
                onRename={() => onRenameWorkspace(desk)}
                onRemove={() => onRemoveWorkspace(desk)}
              />
              {!isCollapsed && (
                <ul
                  role="group"
                  aria-label={`sessions in ${desk.name}`}
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {desk.sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      active={s.id === activeSessionId && desk.id === activeDeskId}
                      unread={unread.has(s.id)}
                      onSelect={() => onSelectSession(s.id)}
                      onRename={() => onRenameSession(s)}
                      onRemove={() => onRemoveSession(s)}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One workspace folder row: chevron + tinted workspace glyph + name,
 *  with the new-session [+] and the ⋯ menu on the right. Clicking the
 *  row toggles collapse — sessions are what select. */
function FolderRow({
  desk,
  active,
  collapsed,
  unread,
  busy,
  onToggle,
  onCreateSession,
  onRename,
  onRemove,
}: {
  readonly desk: Desk;
  readonly active: boolean;
  readonly collapsed: boolean;
  /** Rolled-up dot — only shown while collapsed (rows carry their own). */
  readonly unread: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onCreateSession: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [hot, setHot] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = hot || menuOpen;

  return (
    <div
      data-testid={`desk-row-${desk.id}`}
      data-collapsed={collapsed}
      // The row body is the primary action (toggle collapse). Make it a real
      // keyboard-activatable control: a focusable button-role that fires on
      // Enter/Space, so the tree is navigable without a pointer.
      role="button"
      tabIndex={0}
      aria-label={`${collapsed ? 'expand' : 'collapse'} workspace ${desk.name}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocusCapture={() => setHot(true)}
      onBlurCapture={() => setHot(false)}
      className="row-button"
      style={{
        position: 'relative',
        // While its ⋯ menu is open this row must paint ABOVE the rows
        // below it — the menu is anchored inside this row's subtree, and
        // the ActionsOverlay's `transform` traps the menu's own z-index
        // in a local stacking context, so without lifting the row a later
        // sibling row would paint over the open menu (it appears
        // see-through / overlapped). See RowMenu.
        zIndex: menuOpen ? 30 : undefined,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 32,
        padding: '4px 4px 4px 4px',
        borderRadius: 8,
        cursor: 'pointer',
        color: 'var(--color-sidebar-text)',
      }}
    >
      <button
        type="button"
        data-testid={`desk-toggle-${desk.id}`}
        // The row itself is now the accessible toggle (role=button + key
        // handler), so the chevron is a redundant visual affordance for mouse
        // users — keep it clickable but out of the tab order and hidden from
        // assistive tech to avoid a duplicate tab stop / double announcement.
        tabIndex={-1}
        aria-hidden
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          flexShrink: 0,
          color: 'var(--color-sidebar-text-dim)',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: collapsed ? 'none' : 'rotate(90deg)',
            transition: 'transform 120ms ease',
          }}
        >
          <Icon name="chevron-right" size={13} />
        </span>
      </button>
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: desk.color,
        }}
      >
        <Icon name="folder" size={14} />
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: active ? 700 : 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={`${desk.name} — ${desk.cwd}`}
      >
        {desk.name}
      </span>
      {unread && <UnreadDot label={`unread activity in ${desk.name}`} />}
      <ActionsOverlay show={showActions || busy} background={HOVER_ROW_BG}>
        <button
          type="button"
          data-testid={`session-new-${desk.id}`}
          aria-label={`new session in ${desk.name}`}
          title="New session"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onCreateSession();
          }}
          style={{
            ...iconButtonStyle,
            opacity: busy ? 0.5 : 0.9,
          }}
        >
          <Icon name="plus" size={14} />
        </button>
        <RowMenu
          kind="workspace"
          name={desk.name}
          visible={showActions || busy}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRename={onRename}
          onDelete={onRemove}
          deleteLabel="Remove"
        />
      </ActionsOverlay>
    </div>
  );
}

/** One session row, indented under its folder. */
function SessionRow({
  session: s,
  active,
  unread,
  onSelect,
  onRename,
  onRemove,
}: {
  readonly session: DeskSession;
  readonly active: boolean;
  readonly unread: boolean;
  readonly onSelect: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [hot, setHot] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Hover/menu only — NOT `active`: actions overlay the name's right edge
  // now, so pinning them open on the active row would permanently cover
  // the end of its title.
  const showActions = hot || menuOpen;

  return (
    <li>
      <div
        data-testid={`session-row-${s.id}`}
        data-active={active}
        // The session row is the routing unit; make it keyboard-selectable
        // (Enter/Space) and focusable so screen-reader / keyboard users can
        // pick a session, not just pointer users.
        role="button"
        tabIndex={0}
        aria-label={`open session ${s.name}`}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        onFocusCapture={() => setHot(true)}
        onBlurCapture={() => setHot(false)}
        className={active ? undefined : 'row-button'}
        style={{
          position: 'relative',
          // While its ⋯ menu is open, lift this row above the rows below
          // so the menu (anchored in this row's subtree, with its z-index
          // trapped inside the ActionsOverlay's transform stacking
          // context) paints opaquely over them instead of being covered.
          zIndex: menuOpen ? 30 : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 32,
          padding: '4px 4px 4px 32px',
          borderRadius: 8,
          cursor: 'pointer',
          background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
          color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
          fontWeight: active ? 600 : 400,
        }}
      >
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
        {unread && <UnreadDot label="unread activity" />}
        <ActionsOverlay
          show={showActions}
          background={active ? 'var(--color-sidebar-bg-active)' : HOVER_ROW_BG}
        >
          <RowMenu
            kind="session"
            name={s.name}
            visible={showActions}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onRename={onRename}
            onDelete={onRemove}
            deleteLabel="Delete"
          />
        </ActionsOverlay>
      </div>
    </li>
  );
}

/**
 * The composite a hovered `.row-button` shows: the sidebar background with
 * the hover inset tint (5% text) mixed in. Used as the overlay's masking
 * color so the action cluster blends into the hovered row underneath it.
 */
const HOVER_ROW_BG = 'color-mix(in srgb, var(--color-text) 5%, var(--color-sidebar-bg))';

/**
 * Hover-only action cluster overlaying the row's right edge — the name keeps
 * the FULL row width when idle, and on hover the buttons float above its
 * tail end instead of permanently truncating it. The left gradient fades the
 * covered text out instead of clipping it hard; `pointerEvents` gates clicks
 * so the invisible cluster never swallows a row click.
 */
function ActionsOverlay({
  show,
  background,
  children,
}: {
  readonly show: boolean;
  /** Opaque color matching the row's CURRENT background (hover tint / active wash). */
  readonly background: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      style={{
        position: 'absolute',
        right: 3,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: 18,
        opacity: show ? 1 : 0,
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 120ms ease',
        background: `linear-gradient(to right, transparent, ${background} 16px)`,
        borderRadius: 7,
      }}
    >
      {children}
    </span>
  );
}

function UnreadDot({ label }: { readonly label: string }): JSX.Element {
  return (
    <span
      aria-label={label}
      title="New activity"
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'var(--color-primary)',
        flexShrink: 0,
        boxShadow: '0 0 8px color-mix(in srgb, var(--color-primary) 60%, transparent)',
      }}
    />
  );
}

/** The hover-only ⋯ trigger + its tiny Rename/Delete popover, shared by
 *  folder and session rows (`subject` feeds the aria labels: "session
 *  actions Foo" / "workspace actions Bar"). Closes on outside-click,
 *  Escape, or item selection. */
function RowMenu({
  kind,
  name,
  visible,
  open,
  onOpenChange,
  onRename,
  onDelete,
  deleteLabel,
}: {
  /** Spliced into aria labels: "<kind> actions <name>". */
  readonly kind: 'session' | 'workspace';
  readonly name: string;
  readonly visible: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly deleteLabel: 'Delete' | 'Remove';
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  // Focus the first item on open + restore focus to the trigger on close, with
  // ArrowUp/Down/Home/End/Tab handling inside the popover. The same ref is
  // attached to the portaled menu container below.
  const menuRef = useMenuKeyboard<HTMLDivElement>(open);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        onOpenChange(false);
      }
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

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    const updatePosition = (): void => {
      if (rootRef.current) setMenuPosition(positionMenu(rootRef.current));
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

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

  const menu =
    open && menuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${kind} actions ${name}`}
            // A click inside the popover must not bubble to the row (which
            // would select the session / toggle the folder under the menu).
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: menuPosition.top,
              left: menuPosition.left,
              zIndex: 1100,
              width: menuPosition.width,
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
              aria-label={`rename ${kind} ${name}`}
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
              aria-label={`remove ${kind} ${name}`}
              className="row-button"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
              style={{ ...item, color: 'var(--color-red-text)' }}
            >
              <Icon name="x" size={13} />
              <span>{deleteLabel}</span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <button
          type="button"
          aria-label={`${kind} actions ${name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            if (!open && rootRef.current) setMenuPosition(positionMenu(rootRef.current));
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
      </div>
      {menu}
    </>
  );
}

interface MenuPosition {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}

const MENU_WIDTH = 144;
const MENU_MARGIN = 8;

function positionMenu(anchor: HTMLElement): MenuPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || MENU_WIDTH;
  const maxLeft = Math.max(MENU_MARGIN, viewportWidth - MENU_WIDTH - MENU_MARGIN);
  return {
    top: rect.bottom + 4,
    left: Math.min(Math.max(MENU_MARGIN, rect.right - MENU_WIDTH), maxLeft),
    width: MENU_WIDTH,
  };
}

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 7,
  color: 'var(--color-sidebar-text-dim)',
  flexShrink: 0,
};
