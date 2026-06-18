/**
 * UI shared by the two file panes in the context rail — "Files changed"
 * ({@link FilesPane}) and "Files" ({@link FilesExplorerPane}). Both render the
 * workspace tree on the left and a file viewer on the right, and both open the
 * same click menu (Add to agent / Open). Keeping the menu + list chrome here
 * means the two panes can't drift apart.
 */

import { Icon } from '@moxxy/desktop-ui';
import type { FileInsertDetail } from '../WorkspaceFiles';

/** A pending file click-menu, anchored at the click point. */
export interface MenuState {
  readonly detail: FileInsertDetail;
  /** True when the file is git-changed (Open shows a diff, not content). */
  readonly changed: boolean;
  readonly x: number;
  readonly y: number;
}

/**
 * The click menu shared by both file panes: Add the file to the agent (the
 * existing attachment flow) or Open it in the viewer — a diff for a git-changed
 * file, full content otherwise.
 */
export function FileMenu({
  menu,
  onAdd,
  onOpen,
}: {
  readonly menu: MenuState;
  readonly onAdd: () => void;
  readonly onOpen: () => void;
}): JSX.Element {
  // Anchor at the click; clamp to viewport so it never overflows off-screen.
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 96);
  return (
    <div
      role="menu"
      // Stop the window mousedown-to-close from firing for clicks inside.
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 50,
        minWidth: 184,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 4,
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 12,
        boxShadow: '0 18px 40px -22px rgba(15, 23, 42, 0.45)',
      }}
    >
      <MenuItem icon="attach" label="Add to agent" onClick={onAdd} />
      <MenuItem icon={menu.changed ? 'diff' : 'file'} label={menu.changed ? 'Open diff' : 'Open'} onClick={onOpen} />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  readonly icon: 'attach' | 'file' | 'diff';
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="row-button"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 9px',
        borderRadius: 8,
        fontSize: 12.5,
        color: 'var(--color-text)',
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

/** A titled list section with an optional right-aligned action. */
export function Group({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section style={{ marginBottom: 12 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--color-text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 6,
          padding: '0 4px',
        }}
      >
        <span>{title}</span>
        {action && (
          <>
            <span style={{ flex: 1 }} />
            {action}
          </>
        )}
      </header>
      {children}
    </section>
  );
}

/** Dim hint / empty-state text. */
export function Hint({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return <div style={{ fontSize: 11, color: 'var(--color-text-dim)', padding: '2px 4px' }}>{children}</div>;
}

/** Square icon-button style for in-list actions (e.g. a reload button). */
export const iconBtn: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 6,
  color: 'var(--color-text-dim)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
