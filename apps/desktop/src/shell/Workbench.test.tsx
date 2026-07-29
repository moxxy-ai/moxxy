import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { Workbench, workbenchTabForTool } from './Workbench';

// The panes themselves are out of scope here: they mount xterm (a real canvas)
// and their own IPC. These tests are about the tab strip's contract — how you get
// into the workbench and, crucially, back out of it.
vi.mock('./surfaces/TerminalPane', () => ({ TerminalPane: () => <div data-testid="pane-terminal" /> }));
vi.mock('./surfaces/FilesPane', () => ({ FilesPane: () => <div data-testid="pane-files" /> }));
vi.mock('./surfaces/FilesExplorerPane', () => ({
  FilesExplorerPane: () => <div data-testid="pane-explorer" />,
}));
vi.mock('./surfaces/BrowserPane', () => ({ BrowserPane: () => <div data-testid="pane-browser" /> }));

/**
 * The workbench replaced a drawer that was undiscoverable when closed and could
 * only show one pane. What is pinned here is that you can always get INTO it and
 * always get OUT of it — the second half is not hypothetical: with the collapse
 * button in the same flex row as four labelled tabs, a narrow workbench pushed
 * it past the right edge and an opened workbench could not be closed at all.
 */

beforeEach(() => {
  // A shape-correct desks payload: the component resolves the active desk's cwd
  // for the Files pane, and a bare `{}` leaves `desks.desks` undefined once the
  // fetch settles (the first render passes, every later one throws).
  __setApiOverride({
    invoke: vi.fn(async () => ({ desks: [], activeId: null })),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

const TABS = ['terminal', 'explorer', 'files', 'browser'] as const;

describe('Workbench, collapsed', () => {
  it('still shows every pane as a stub, so it is never invisible', () => {
    render(<Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />);
    for (const id of TABS) {
      expect(screen.getByTestId(`bench-open-${id}`), `stub ${id} missing`).toBeTruthy();
    }
  });

  it('opens straight onto the pane whose stub was clicked', () => {
    const onPick = vi.fn();
    render(<Workbench tab={null} onPick={onPick} onClose={vi.fn()} workspaceId="ws" />);
    fireEvent.click(screen.getByTestId('bench-open-files'));
    expect(onPick).toHaveBeenCalledWith('files');
  });

  it('badges the diff stub with the changed-file count, and hides a zero', () => {
    const { rerender } = render(
      <Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" changedCount={12} />,
    );
    expect(screen.getByTestId('bench-open-files').textContent).toContain('12');
    rerender(
      <Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" changedCount={0} />,
    );
    expect(screen.getByTestId('bench-open-files').textContent).not.toContain('0');
  });
});

describe('Workbench, open', () => {
  it('keeps the collapse button reachable', () => {
    const onClose = vi.fn();
    render(<Workbench tab="terminal" onPick={vi.fn()} onClose={onClose} workspaceId="ws" />);
    fireEvent.click(screen.getByTestId('bench-collapse'));
    expect(onClose).toHaveBeenCalled();
  });

  it('puts the collapse button OUTSIDE the scrolling tab list', () => {
    // This is the actual regression. The tab list is what overflows on a narrow
    // workbench; if the collapse button is inside it, it overflows too and there
    // is no way out. It must be a sibling of the list, not a child.
    render(<Workbench tab="terminal" onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />);
    const tablist = screen.getByRole('tablist', { name: 'Workbench panes' });
    expect(tablist.contains(screen.getByTestId('bench-collapse'))).toBe(false);
  });

  it('collapses when the ACTIVE tab is clicked, and switches on any other', () => {
    const onClose = vi.fn();
    const onPick = vi.fn();
    render(<Workbench tab="terminal" onPick={onPick} onClose={onClose} workspaceId="ws" />);

    fireEvent.click(screen.getByTestId('bench-tab-terminal'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('bench-tab-browser'));
    expect(onPick).toHaveBeenCalledWith('browser');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks exactly the active tab selected', () => {
    render(<Workbench tab="files" onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />);
    const selected = TABS.filter(
      (id) => screen.getByTestId(`bench-tab-${id}`).getAttribute('aria-selected') === 'true',
    );
    expect(selected).toEqual(['files']);
  });
});

describe('workbenchTabForTool', () => {
  it('maps the surface-backed tools to their pane, and nothing else', () => {
    expect(workbenchTabForTool('terminal')).toBe('terminal');
    expect(workbenchTabForTool('browser_session')).toBe('browser');
    expect(workbenchTabForTool('Read')).toBeUndefined();
  });
});
