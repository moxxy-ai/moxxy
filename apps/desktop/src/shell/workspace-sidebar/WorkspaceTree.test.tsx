/**
 * WorkspaceTree — the run list, grouped into one section per workspace:
 *   1. A section header per desk; run rows sit under expanded sections only.
 *   2. Chevron / header click toggles collapse (buttons inside don't).
 *   3. [+] on a header creates a session IN that desk.
 *   4. Runs select; the active desk's active session is highlighted.
 *   5. A run row reads like a conversation: avatar, name, time, preview, and a
 *      badge on the avatar for unread or working. Unread rolls up onto the
 *      header only while the section is collapsed.
 *   6. ⋯ menus only request rename/remove flows; parent containers own
 *      modals and persistence.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

const NOW = Date.parse('2026-10-07T12:00:00Z');

type Handlers = Parameters<typeof WorkspaceTree>[0];

function renderTree(over: Partial<Handlers> = {}): {
  onToggleCollapse: ReturnType<typeof vi.fn>;
  onSelectSession: ReturnType<typeof vi.fn>;
  onCreateSession: ReturnType<typeof vi.fn>;
  onRenameSession: ReturnType<typeof vi.fn>;
  onRemoveSession: ReturnType<typeof vi.fn>;
  onRenameWorkspace: ReturnType<typeof vi.fn>;
  onRemoveWorkspace: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onToggleCollapse: vi.fn(),
    onSelectSession: vi.fn(),
    onCreateSession: vi.fn(),
    onRenameSession: vi.fn(),
    onRemoveSession: vi.fn(),
    onRenameWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
  };
  render(
    <WorkspaceTree
      desks={[
        desk({
          id: 'a',
          name: 'Alpha',
          sessions: [
            { id: 'a', name: 'Session 1', createdAt: 1 },
            {
              id: 'a2',
              name: 'Fix the login bug',
              createdAt: 2,
              lastActivity: new Date(NOW - 4 * 60_000).toISOString(),
            },
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
      running={new Set()}
      previews={new Map()}
      now={NOW}
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
    const alphaGroup = screen.getByTestId('workspace-group-a');
    const betaGroup = screen.getByTestId('workspace-group-b');
    expect(alphaGroup.dataset.active).toBe('true');
    expect(betaGroup.dataset.active).toBe('false');
    expect(screen.getByTestId('desk-row-a')).toBeTruthy();
    expect(screen.getByTestId('desk-row-b')).toBeTruthy();
    expect(screen.getByTestId('session-row-a')).toBeTruthy();
    expect(screen.getByTestId('session-row-a2')).toBeTruthy();
    expect(screen.getByTestId('session-row-b')).toBeTruthy();
    expect(alphaGroup.contains(screen.getByTestId('session-row-a2'))).toBe(true);
    expect(betaGroup.contains(screen.getByTestId('session-row-b'))).toBe(true);
    expect(screen.getByRole('group', { name: 'sessions in Alpha' })).toBeTruthy();
  });

  it('hides a collapsed folder’s sessions', () => {
    renderTree({ collapsed: new Set(['a']) });
    expect(screen.getByTestId('workspace-group-a').dataset.collapsed).toBe('true');
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

  it('requests a session rename flow from the ⋯ menu without selecting the row', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    fireEvent.click(screen.getByLabelText('rename session Fix the login bug'));
    expect(h.onRenameSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2', name: 'Fix the login bug' }),
    );
    expect(h.onSelectSession).not.toHaveBeenCalled();
  });

  it('deletes a session from its ⋯ menu without selecting the row', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    const menu = screen.getByRole('menu', { name: 'session actions Fix the login bug' });
    expect(menu.parentElement).toBe(document.body);
    fireEvent.click(screen.getByLabelText('remove session Fix the login bug'));
    expect(h.onRemoveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2' }),
    );
    expect(h.onSelectSession).not.toHaveBeenCalled();
  });

  it('requests workspace rename/remove flows from its ⋯ menu (no collapse toggle)', () => {
    const h = renderTree();
    fireEvent.click(screen.getByLabelText('workspace actions Alpha'));
    fireEvent.click(screen.getByLabelText('rename workspace Alpha'));
    expect(h.onRenameWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', name: 'Alpha' }),
    );

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

  it('draws a run as a conversation: avatar, name, time and a preview', () => {
    renderTree({ previews: new Map([['a2', 'The first PDF test now waits.']]) });
    const row = screen.getByTestId('session-row-a2');
    expect(within(row).getByTestId('session-avatar')).toHaveTextContent('F');
    expect(row).toHaveTextContent('Fix the login bug');
    expect(within(row).getByTestId('session-time')).toHaveTextContent('4m');
    expect(within(row).getByTestId('session-preview')).toHaveTextContent(
      'The first PDF test now waits.',
    );
  });

  it('leaves out the time and the preview rather than inventing them', () => {
    renderTree();
    const row = screen.getByTestId('session-row-a');
    expect(within(row).queryByTestId('session-time')).toBeNull();
    expect(within(row).queryByTestId('session-preview')).toBeNull();
  });

  it('badges the avatar of a run that is working', () => {
    renderTree({ running: new Set(['a']) });
    const row = screen.getByTestId('session-row-a');
    expect(within(row).getByLabelText('working')).toBeTruthy();
    expect(within(screen.getByTestId('session-row-a2')).queryByLabelText('working')).toBeNull();
  });

  it('tells a workspace from a run: a colour chip on the header, an avatar on the row', () => {
    renderTree();
    expect(screen.getByTestId('desk-chip-a').style.background).toBe('rgb(59, 130, 246)');
    expect(within(screen.getByTestId('desk-row-a')).queryByTestId('session-avatar')).toBeNull();
    expect(within(screen.getByTestId('session-row-a')).getByTestId('session-avatar')).toBeTruthy();
  });

  it('says how many runs a workspace holds without opening it', () => {
    renderTree({ collapsed: new Set(['a']) });
    expect(screen.getByTestId('desk-row-a')).toHaveTextContent('2');
  });

  // The row's actions only show on hover, and the menu is portalled out of the
  // row: without holding the row "open" the ⋯ would fade out from under its own
  // menu the moment the pointer moved onto it.
  it('keeps a row\'s actions up while its ⋯ menu is open', () => {
    renderTree();
    const row = screen.getByTestId('session-row-a2');
    expect(row).not.toHaveAttribute('data-menu-open');

    fireEvent.click(screen.getByLabelText('session actions Fix the login bug'));
    expect(row).toHaveAttribute('data-menu-open', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(row).not.toHaveAttribute('data-menu-open');
  });
});
