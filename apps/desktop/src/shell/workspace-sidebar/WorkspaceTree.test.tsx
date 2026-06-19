/**
 * WorkspaceTree — collapsible workspace folders with nested sessions:
 *   1. Folder row per desk; session rows nest under expanded folders only.
 *   2. Chevron / row click toggles collapse (buttons inside don't).
 *   3. [+] on a folder creates a session IN that desk; header [+] makes
 *      a new workspace.
 *   4. Sessions select; the active desk's active session is highlighted.
 *   5. Unread dots: per-session when expanded, rolled up onto the folder
 *      only while collapsed.
 *   6. ⋯ menus rename/remove both row kinds (inline rename: Enter commits
 *      trimmed, Escape cancels, unchanged name is a no-op).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { WorkspaceTree } from './WorkspaceTree';

function desk(over: Partial<Desk> & { id: string }): Desk {
  return {
    name: over.id,
    cwd: `/tmp/${over.id}`,
    color: '#3b82f6',
    createdAt: 1,
    sessions: [{ id: `${over.id}`, name: 'Session 1', createdAt: 1 }],
    activeSessionId: over.id,
    ...over,
  };
}

type Handlers = Parameters<typeof WorkspaceTree>[0];

function renderTree(over: Partial<Handlers> = {}): {
  onToggleCollapse: ReturnType<typeof vi.fn>;
  onSelectSession: ReturnType<typeof vi.fn>;
  onCreateSession: ReturnType<typeof vi.fn>;
  onRenameSession: ReturnType<typeof vi.fn>;
  onRemoveSession: ReturnType<typeof vi.fn>;
  onRenameWorkspace: ReturnType<typeof vi.fn>;
  onRemoveWorkspace: ReturnType<typeof vi.fn>;
  onNewWorkspace: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onToggleCollapse: vi.fn(),
    onSelectSession: vi.fn(),
    onCreateSession: vi.fn(),
    onRenameSession: vi.fn(),
    onRemoveSession: vi.fn(),
    onRenameWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
    onNewWorkspace: vi.fn(),
  };
  render(
    <WorkspaceTree
      desks={[
        desk({
          id: 'a',
          name: 'Alpha',
          sessions: [
            { id: 'a', name: 'Session 1', createdAt: 1 },
            { id: 'a2', name: 'Fix the login bug', createdAt: 2 },
          ],
          activeSessionId: 'a2',
        }),
        desk({
        id: 'b',
        name: 'Beta',
        sessions: [{ id: 'b', name: 'Beta chat', createdAt: 1 }],
      }),
      ]}
      activeDeskId="a"
      activeSessionId="a2"
      unread={new Set()}
      collapsed={new Set()}
      busyDeskId={null}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

describe('WorkspaceTree', () => {
  it('renders a folder row per desk with its sessions nested below', () => {
    renderTree();
    expect(screen.getByTestId('desk-row-a')).toBeTruthy();
    expect(screen.getByTestId('desk-row-b')).toBeTruthy();
    expect(screen.getByTestId('session-row-a')).toBeTruthy();
    expect(screen.getByTestId('session-row-a2')).toBeTruthy();
    expect(screen.getByTestId('session-row-b')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'sessions in Alpha' })).toBeTruthy();
  });

  it('hides a collapsed folder’s sessions', () => {
    renderTree({ collapsed: new Set(['a']) });
    expect(screen.queryByTestId('session-row-a')).toBeNull();
    expect(screen.queryByTestId('session-row-a2')).toBeNull();
    expect(screen.getByTestId('session-row-b')).toBeTruthy(); // other desk untouched
  });

  it('chevron and folder-row clicks toggle collapse', () => {
    const h = renderTree();
    fireEvent.click(screen.getByTestId('desk-toggle-a'));
    expect(h.onToggleCollapse).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByTestId('desk-row-b'));
    expect(h.onToggleCollapse).toHaveBeenCalledWith('b');
    expect(h.onSelectSession).not.toHaveBeenCalled();
  });

  it('folder [+] creates a session in THAT desk without toggling collapse', () => {
    const h = renderTree();
    fireEvent.click(screen.getByTestId('session-new-b'));
    expect(h.onCreateSession).toHaveBeenCalledWith('b');
    expect(h.onToggleCollapse).not.toHaveBeenCalled();
  });

  it('header [+] starts a new workspace', () => {
    const h = renderTree();
    fireEvent.click(screen.getByTestId('workspace-new'));
    expect(h.onNewWorkspace).toHaveBeenCalled();
  });

  it('clicking a session selects it (cross-desk too)', () => {
    const h = renderTree();
    fireEvent.click(screen.getByTestId('session-row-b'));
    expect(h.onSelectSession).toHaveBeenCalledWith('b');
  });

  it('highlights only the active desk’s active session', () => {
    renderTree();
    expect(screen.getByTestId('session-row-a2').dataset.active).toBe('true');
    expect(screen.getByTestId('session-row-a').dataset.active).toBe('false');
    // desk b's own activeSessionId is not the foreground session
    expect(screen.getByTestId('session-row-b').dataset.active).toBe('false');
  });

  it('shows session unread dots when expanded, and rolls them up onto the folder only when collapsed', () => {
    renderTree({ unread: new Set(['a2', 'b']), collapsed: new Set(['b']) });
    expect(screen.getByLabelText('unread activity')).toBeTruthy(); // a2's row dot
    expect(screen.getByLabelText('unread activity in Beta')).toBeTruthy();
    expect(screen.queryByLabelText('unread activity in Alpha')).toBeNull(); // expanded → no rollup
  });

  it('renames a session inline (Enter commits the trimmed name)', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    fireEvent.click(screen.getByLabelText('rename session Fix the login bug'));
    const input = screen.getByLabelText(
      'rename session Fix the login bug',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Login deep-dive  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.onRenameSession).toHaveBeenCalledWith('a2', 'Login deep-dive');
  });

  it('Escape cancels a rename; an unchanged name never commits', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('session actions Session 1'));
    fireEvent.click(screen.getByLabelText('rename session Session 1'));
    const input = screen.getByLabelText('rename session Session 1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'whatever' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(h.onRenameSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('session actions Session 1'));
    fireEvent.click(screen.getByLabelText('rename session Session 1'));
    const again = screen.getByLabelText('rename session Session 1') as HTMLInputElement;
    fireEvent.keyDown(again, { key: 'Enter' }); // committed draft === current name
    expect(h.onRenameSession).not.toHaveBeenCalled();
  });

  it('deletes a session from its ⋯ menu without selecting the row', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    fireEvent.click(screen.getByLabelText('remove session Fix the login bug'));
    expect(h.onRemoveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2' }),
    );
    expect(h.onSelectSession).not.toHaveBeenCalled();
  });

  it('renames and removes a workspace from its ⋯ menu (no collapse toggle)', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('workspace actions Alpha'));
    fireEvent.click(screen.getByLabelText('rename workspace Alpha'));
    const input = screen.getByLabelText('rename workspace Alpha') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Apex' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.onRenameWorkspace).toHaveBeenCalledWith('a', 'Apex');

    fireEvent.click(screen.getByLabelText('workspace actions Beta'));
    fireEvent.click(screen.getByLabelText('remove workspace Beta'));
    expect(h.onRemoveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b' }),
    );
    expect(h.onToggleCollapse).not.toHaveBeenCalled();
  });

  // Accessibility: the row body is the primary action (folder toggle /
  // session select) and must be keyboard-operable, not a mouse-only <div>.
  it('makes rows keyboard-activatable (Enter/Space) with button semantics', () => {
    const h = renderTree();
    const folder = screen.getByTestId('desk-row-b');
    const session = screen.getByTestId('session-row-b');
    // Real button semantics + reachable in the tab order.
    expect(folder.getAttribute('role')).toBe('button');
    expect(folder.tabIndex).toBe(0);
    expect(session.getAttribute('role')).toBe('button');
    expect(session.tabIndex).toBe(0);

    fireEvent.keyDown(folder, { key: 'Enter' });
    expect(h.onToggleCollapse).toHaveBeenCalledWith('b');
    fireEvent.keyDown(session, { key: ' ' });
    expect(h.onSelectSession).toHaveBeenCalledWith('b');
  });

  it('marks the rename input inert (no button role) so it stays editable', () => {
    renderTree();
    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    fireEvent.click(screen.getByLabelText('rename session Fix the login bug'));
    const row = screen.getByTestId('session-row-a2');
    // While editing the row must not capture Enter/Space as a select.
    expect(row.getAttribute('role')).toBeNull();
  });

  // Accessibility: opening the ⋯ menu must move focus into it (first item) so a
  // keyboard / screen-reader user can act, and closing must restore focus to
  // the trigger rather than dropping it to <body>.
  it('focuses the first menu item on open and restores focus to the trigger on close', () => {
    renderTree();
    const trigger = screen.getByLabelText('session actions Fix the login bug');
    // A real browser focuses a button on click; jsdom doesn't, so focus it
    // explicitly to mirror the activeElement state the hook captures at open.
    trigger.focus();
    fireEvent.click(trigger);
    const rename = screen.getByLabelText('rename session Fix the login bug');
    expect(document.activeElement).toBe(rename);

    // ArrowDown moves to the next item (Remove); does not escape the menu.
    fireEvent.keyDown(rename, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByLabelText('remove session Fix the login bug'));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  // Regression: the ⋯ menu is anchored inside the row's subtree, and the
  // ActionsOverlay's `transform` traps the menu's z-index in a local
  // stacking context. Without lifting the owning row while its menu is
  // open, a LATER sibling row paints over the menu (it looked see-through
  // and overlapped the next folder). The row must carry a z-index only
  // while its menu is open, and drop it again on close.
  it('lifts the row that owns an open ⋯ menu above the rows below it', () => {
    renderTree();
    const row = screen.getByTestId('session-row-a2');
    expect(row.style.zIndex).toBe(''); // idle: no stacking lift

    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    expect(row.style.zIndex).not.toBe(''); // open: lifted above following rows

    // Closing the menu (Escape) drops the lift again so it never stacks
    // permanently over its neighbours.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(row.style.zIndex).toBe('');
  });
});
