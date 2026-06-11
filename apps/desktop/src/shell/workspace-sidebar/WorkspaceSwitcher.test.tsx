/**
 * WorkspaceSwitcher tests:
 *   1. The card shows the active workspace's name + session count.
 *   2. Opening the dropdown lists every workspace; the active one carries
 *      the ✓ and unread desks show the activity dot.
 *   3. Selecting another workspace fires onSelect and closes the menu.
 *   4. The row's × fires onRemove WITHOUT selecting.
 *   5. "New workspace" fires onNewWorkspace.
 *   6. Escape and outside-click both close the dropdown.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

function desk(id: string, name: string): Desk {
  return {
    id,
    name,
    cwd: `/tmp/${id}`,
    color: '#ec4899',
    createdAt: 1,
    sessions: [{ id, name: 'Session 1', createdAt: 1 }],
    activeSessionId: id,
  };
}

const d1 = desk('d1', 'Personal Workspace');
const d2 = desk('d2', 'Side Project');

function setup(
  overrides: Partial<React.ComponentProps<typeof WorkspaceSwitcher>> = {},
): {
  onSelect: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
  onNewWorkspace: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onSelect: vi.fn(),
    onRemove: vi.fn(),
    onNewWorkspace: vi.fn(),
  };
  render(
    <WorkspaceSwitcher
      desks={[d1, d2]}
      activeDeskId="d1"
      unreadDeskIds={new Set(['d2'])}
      sessionCount={3}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

function openDropdown(): void {
  fireEvent.click(screen.getByTestId('workspace-switcher'));
}

describe('WorkspaceSwitcher', () => {
  it('the card shows the active workspace name and session count', () => {
    setup();
    const card = screen.getByTestId('workspace-switcher');
    expect(card.textContent).toContain('Personal Workspace');
    expect(card.textContent).toContain('3 sessions');
    expect(card.getAttribute('aria-haspopup')).toBe('menu');
    expect(card.getAttribute('aria-expanded')).toBe('false');
  });

  it('singular session count reads "1 session"', () => {
    setup({ sessionCount: 1 });
    expect(screen.getByTestId('workspace-switcher').textContent).toContain('1 session');
  });

  it('opening the dropdown lists workspaces with the active ✓ + unread dot', () => {
    setup();
    openDropdown();
    expect(screen.getByTestId('desk-row-d1')).toBeTruthy();
    expect(screen.getByTestId('desk-row-d2')).toBeTruthy();
    expect(screen.getByTestId('desk-row-d1').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('desk-row-d2').getAttribute('data-active')).toBe('false');
    // The ✓ marks only the current workspace…
    expect(screen.getAllByLabelText('current workspace')).toHaveLength(1);
    // …and the unread dot only the flagged one.
    expect(screen.getAllByLabelText('unread activity')).toHaveLength(1);
  });

  it('selecting another workspace fires onSelect and closes', () => {
    const { onSelect } = setup();
    openDropdown();
    fireEvent.click(screen.getByTestId('desk-row-d2'));
    expect(onSelect).toHaveBeenCalledWith('d2');
    expect(screen.queryByTestId('desk-row-d2')).toBeNull();
  });

  it("a row's × fires onRemove without selecting", () => {
    const { onRemove, onSelect } = setup();
    openDropdown();
    fireEvent.click(screen.getByLabelText('remove workspace Side Project'));
    expect(onRemove).toHaveBeenCalledWith(d2);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('"New workspace" fires onNewWorkspace', () => {
    const { onNewWorkspace } = setup();
    openDropdown();
    fireEvent.click(screen.getByTestId('desk-new'));
    expect(onNewWorkspace).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the dropdown', () => {
    setup();
    openDropdown();
    expect(screen.getByTestId('desk-row-d1')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('desk-row-d1')).toBeNull();
  });

  it('clicking outside closes the dropdown', () => {
    setup();
    openDropdown();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('desk-row-d1')).toBeNull();
  });
});
