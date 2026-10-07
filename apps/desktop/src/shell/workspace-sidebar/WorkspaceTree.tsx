import { useState, type KeyboardEvent } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { Desk, DeskSession } from '@moxxy/desktop-ipc-contract';
import { PopoverMenu } from '../menu/PopoverMenu';
import { usePopover } from '../menu/usePopover';
import { SessionAvatar } from './SessionAvatar';
import { formatSessionTime } from './session-time';

/**
 * The run list: one section per workspace, its runs beneath it.
 *
 *   ▾ ■ moxxy                              3  + ⋯   ← section: fold / count / new / menu
 *     (D) Desktop redesign               4m         ← run: avatar, name, time
 *         Got it. Tokens are in and the…            ← and the latest message
 *   ▸ ■ marketing-site                 ●   2        ← folded: unread rolls up
 *
 * A run reads like a conversation in a messenger, because that is what it is.
 * A workspace is only a heading over its runs, so it is drawn smaller and
 * quieter than any of them.
 *
 * Interaction contract:
 *  - a section header folds its runs; switching workspace happens by picking
 *    one of its runs, the routing unit;
 *  - [+] on a header creates a session IN that workspace;
 *  - ⋯ menus carry Rename and Remove for both row kinds and hand the modal and
 *    persistence to the sidebar container;
 *  - row actions show on hover, on focus, and while their menu is open, and lie
 *    over the row's right edge instead of reserving width;
 *  - the active desk's active session is the single highlighted row.
 *
 * Presentational: the sidebar container owns the stores, the fold state and the
 * action modals.
 */
export function WorkspaceTree({
  desks,
  activeDeskId,
  activeSessionId,
  unread,
  running,
  previews,
  now,
  collapsed,
  busyDeskId,
  onToggleCollapse,
  onSelectSession,
  onCreateSession,
  onRenameSession,
  onRemoveSession,
  onRenameWorkspace,
  onRemoveWorkspace,
}: {
  readonly desks: ReadonlyArray<Desk>;
  readonly activeDeskId: string | null;
  /** The active desk's foreground session: the one highlighted row. */
  readonly activeSessionId: string | null;
  /** Session ids carrying unread activity. */
  readonly unread: ReadonlySet<string>;
  /** Session ids with a turn in flight. */
  readonly running: ReadonlySet<string>;
  /** The second line of each run row, by session id. */
  readonly previews: ReadonlyMap<string, string>;
  /** The time the "4m" readings are measured from. */
  readonly now: number;
  /** Desk ids whose section is folded. */
  readonly collapsed: ReadonlySet<string>;
  /** Desk with a session-create in flight (its [+] disables). */
  readonly busyDeskId: string | null;
  readonly onToggleCollapse: (deskId: string) => void;
  readonly onSelectSession: (id: string) => void;
  readonly onCreateSession: (deskId: string) => void;
  readonly onRenameSession: (session: DeskSession) => void;
  readonly onRemoveSession: (session: DeskSession) => void;
  readonly onRenameWorkspace: (desk: Desk) => void;
  readonly onRemoveWorkspace: (desk: Desk) => void;
}): JSX.Element {
  return (
    <ul role="tree" aria-label="Workspaces" className="run-list">
      {desks.map((desk) => {
        const isCollapsed = collapsed.has(desk.id);
        const hasUnread = desk.sessions.some((s) => unread.has(s.id)) || unread.has(desk.id);
        return (
          <li
            key={desk.id}
            role="treeitem"
            aria-expanded={!isCollapsed}
            className="run-section"
            data-testid={`workspace-group-${desk.id}`}
            data-active={desk.id === activeDeskId}
            data-collapsed={isCollapsed}
          >
            <SectionHeader
              desk={desk}
              collapsed={isCollapsed}
              unread={isCollapsed && hasUnread}
              busy={busyDeskId === desk.id}
              onToggle={() => onToggleCollapse(desk.id)}
              onCreateSession={() => onCreateSession(desk.id)}
              onRename={() => onRenameWorkspace(desk)}
              onRemove={() => onRemoveWorkspace(desk)}
            />
            {!isCollapsed && (
              <ul role="group" aria-label={`sessions in ${desk.name}`} className="run-section__rows">
                {desk.sessions.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeSessionId && desk.id === activeDeskId}
                    unread={unread.has(s.id)}
                    running={running.has(s.id)}
                    preview={previews.get(s.id) ?? null}
                    time={formatSessionTime(s.lastActivity, now)}
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
  );
}

/** Enter or Space on the row itself. A key pressed on a button inside the row
 *  belongs to that button, and must not also act on the row. */
function activateOnKey(action: () => void) {
  return (e: KeyboardEvent<HTMLElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  };
}

/** A workspace heading: fold chevron, colour chip, name and run count, with
 *  new-session and the ⋯ menu over its right edge. */
function SectionHeader({
  desk,
  collapsed,
  unread,
  busy,
  onToggle,
  onCreateSession,
  onRename,
  onRemove,
}: {
  readonly desk: Desk;
  readonly collapsed: boolean;
  /** Rolled-up unread mark; only while folded, since rows carry their own. */
  readonly unread: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onCreateSession: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className="run-section__head"
      data-testid={`desk-row-${desk.id}`}
      data-collapsed={collapsed}
      data-menu-open={menuOpen || busy || undefined}
      role="button"
      tabIndex={0}
      aria-label={`${collapsed ? 'expand' : 'collapse'} workspace ${desk.name}`}
      onClick={onToggle}
      onKeyDown={activateOnKey(onToggle)}
    >
      <button
        type="button"
        className="run-section__chevron"
        data-testid={`desk-toggle-${desk.id}`}
        data-open={!collapsed}
        // The header is the accessible toggle; this is the pointer's larger target.
        tabIndex={-1}
        aria-hidden
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <Icon name="chevron-right" size={12} />
      </button>
      <span
        aria-hidden
        className="run-section__chip"
        data-testid={`desk-chip-${desk.id}`}
        style={{ background: desk.color }}
      />
      <span className="run-section__name" title={`${desk.name} — ${desk.cwd}`}>
        {desk.name}
      </span>
      {unread && (
        <span
          className="run-section__unread"
          role="img"
          aria-label={`unread activity in ${desk.name}`}
        />
      )}
      <span className="run-section__count" aria-hidden>
        {desk.sessions.length}
      </span>
      <span className="row-actions">
        <button
          type="button"
          className="row-actions__btn"
          data-testid={`session-new-${desk.id}`}
          aria-label={`new session in ${desk.name}`}
          title="New session"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onCreateSession();
          }}
        >
          <Icon name="plus" size={14} />
        </button>
        <RowMenu
          kind="workspace"
          name={desk.name}
          onOpenChange={setMenuOpen}
          onRename={onRename}
          onDelete={onRemove}
          deleteLabel="Remove"
        />
      </span>
    </div>
  );
}

/** One run: avatar, name and time, and the latest message under them. */
function SessionRow({
  session: s,
  active,
  unread,
  running,
  preview,
  time,
  onSelect,
  onRename,
  onRemove,
}: {
  readonly session: DeskSession;
  readonly active: boolean;
  readonly unread: boolean;
  readonly running: boolean;
  readonly preview: string | null;
  readonly time: string | null;
  readonly onSelect: () => void;
  readonly onRename: () => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li>
      <div
        className="run-row"
        data-testid={`session-row-${s.id}`}
        data-active={active}
        data-unread={unread || undefined}
        data-menu-open={menuOpen || undefined}
        role="button"
        tabIndex={0}
        aria-label={`open session ${s.name}`}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        onKeyDown={activateOnKey(onSelect)}
      >
        <SessionAvatar
          id={s.id}
          name={s.name}
          badge={running ? 'working' : unread ? 'unread' : null}
        />
        <span className="run-row__text">
          <span className="run-row__line">
            <span className="run-row__name">{s.name}</span>
            {time && (
              <span className="run-row__time" data-testid="session-time">
                {time}
              </span>
            )}
          </span>
          {preview && (
            <span className="run-row__preview" data-testid="session-preview">
              {preview}
            </span>
          )}
        </span>
        <span className="row-actions">
          <RowMenu
            kind="session"
            name={s.name}
            onOpenChange={setMenuOpen}
            onRename={onRename}
            onDelete={onRemove}
            deleteLabel="Delete"
          />
        </span>
      </div>
    </li>
  );
}

const ROW_MENU_WIDTH = 160;

/** The ⋯ trigger and its Rename / Delete menu, shared by both row kinds. */
function RowMenu({
  kind,
  name,
  onOpenChange,
  onRename,
  onDelete,
  deleteLabel,
}: {
  /** Spliced into the accessible names: "<kind> actions <name>". */
  readonly kind: 'session' | 'workspace';
  readonly name: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly deleteLabel: 'Delete' | 'Remove';
}): JSX.Element {
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>({
    side: 'bottom',
    align: 'end',
    width: ROW_MENU_WIDTH,
    onOpenChange,
  });
  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        className="row-actions__btn"
        aria-label={`${kind} actions ${name}`}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={(e) => {
          // The row under this button selects or folds on click.
          e.stopPropagation();
          popover.toggle(e);
        }}
      >
        <Icon name="more" size={14} />
      </button>
      <PopoverMenu
        popover={popover}
        label={`${kind} actions ${name}`}
        entries={[
          {
            id: 'rename',
            label: 'Rename',
            icon: 'pencil',
            ariaLabel: `rename ${kind} ${name}`,
            onSelect: onRename,
          },
          {
            id: 'delete',
            label: deleteLabel,
            icon: 'x',
            danger: true,
            ariaLabel: `remove ${kind} ${name}`,
            onSelect: onDelete,
          },
        ]}
      />
    </>
  );
}
