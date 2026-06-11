/**
 * SessionList renderer tests:
 *   1. Renders one flat row per session; the active one carries the
 *      highlight (data-active) and the unread dot shows for flagged
 *      sessions.
 *   2. Clicking a row selects it; the header [+] fires onCreate.
 *   3. The ⋯ overflow menu opens Rename/Delete: Rename swaps the row to
 *      an inline input (Enter commits trimmed, Escape cancels), Delete
 *      asks the container to remove (it confirms).
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DeskSession } from '@moxxy/desktop-ipc-contract';
import { SessionList } from './SessionList';

const s1: DeskSession = { id: 's1', name: 'Session 1', createdAt: 1 };
const s2: DeskSession = { id: 's2', name: 'Session 2', createdAt: 2 };

function setup(
  overrides: Partial<React.ComponentProps<typeof SessionList>> = {},
): {
  onSelect: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  onRename: ReturnType<typeof vi.fn>;
  onRemove: ReturnType<typeof vi.fn>;
} {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
  };
  render(
    <SessionList
      sessions={[s1, s2]}
      activeSessionId="s1"
      unread={new Set(['s2'])}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

/** Open a row's ⋯ overflow menu. */
function openMenu(name: string): void {
  fireEvent.click(screen.getByLabelText(`session actions ${name}`));
}

describe('SessionList', () => {
  it('renders a row per session with the active highlight + unread dot', () => {
    setup();
    expect(screen.getByText('Session 1')).toBeTruthy();
    expect(screen.getByText('Session 2')).toBeTruthy();
    expect(screen.getByTestId('session-row-s1').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('session-row-s2').getAttribute('data-active')).toBe('false');
    // Only the unread session shows the activity dot.
    expect(screen.getAllByLabelText('unread activity')).toHaveLength(1);
  });

  it('clicking a row selects it', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByTestId('session-row-s2'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('the header [+] fires onCreate', () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByTestId('session-new'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('the header [+] is disabled while busy', () => {
    const { onCreate } = setup({ busy: true });
    const button = screen.getByTestId('session-new');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('opening the ⋯ menu does not select the row', () => {
    const { onSelect } = setup();
    openMenu('Session 2');
    expect(screen.getByRole('menuitem', { name: 'rename session Session 2' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'remove session Session 2' })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape closes the ⋯ menu without acting', () => {
    const { onRename, onRemove } = setup();
    openMenu('Session 2');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'rename session Session 2' })).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('renames inline: ⋯ → Rename → input, Enter commits trimmed', () => {
    const { onRename, onSelect } = setup();
    openMenu('Session 2');
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename session Session 2' }));
    const input = screen.getByDisplayValue('Session 2');
    fireEvent.change(input, { target: { value: '  Deep dive  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('s2', 'Deep dive');
    // Opening the editor must not have selected the row.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape cancels a rename without committing', () => {
    const { onRename } = setup();
    openMenu('Session 2');
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename session Session 2' }));
    const input = screen.getByDisplayValue('Session 2');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Session 2')).toBeTruthy();
  });

  it('an unchanged name does not commit a rename', () => {
    const { onRename } = setup();
    openMenu('Session 2');
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename session Session 2' }));
    const input = screen.getByDisplayValue('Session 2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('⋯ → Delete asks the container to remove (without selecting)', () => {
    const { onRemove, onSelect } = setup();
    openMenu('Session 2');
    fireEvent.click(screen.getByRole('menuitem', { name: 'remove session Session 2' }));
    expect(onRemove).toHaveBeenCalledWith(s2);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
