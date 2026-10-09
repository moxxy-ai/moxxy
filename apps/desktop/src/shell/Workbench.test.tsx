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
// The browser pane counts its mounts: unmounting it destroys its pages.
const browserLife = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
vi.mock('./surfaces/BrowserPane', async () => {
  const { useEffect } = await import('react');
  return {
    BrowserPane: () => {
      useEffect(() => {
        browserLife.mounts += 1;
        return () => {
          browserLife.unmounts += 1;
        };
      }, []);
      return <div data-testid="pane-browser" />;
    },
  };
});

/**
 * Closed, the workbench is gone: the run's header holds the way in. What is
 * pinned here is that an open workbench can always be closed again. That is not
 * hypothetical: with the collapse button in the same flex row as four labelled
 * tabs, a narrow workbench pushed it past the right edge.
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
  it('draws nothing: no strip, no tabs, no way in of its own', () => {
    const { container } = render(
      <Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" changedCount={12} />,
    );
    const aside = container.querySelector('aside');
    expect(aside).toHaveClass('bench--closed');
    expect(aside?.querySelector('button')).toBeNull();
    expect(aside?.textContent).toBe('');
  });

  it('is out of the accessibility tree while it has nothing in it', () => {
    render(<Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />);
    expect(screen.queryByRole('complementary', { name: 'Workbench' })).toBeNull();
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

/**
 * Full view is the Codex gesture: the pane takes the window and the chat
 * shrinks to a composer floating over it. Collapsed, there is nothing to show
 * full, so the toggle is only on an open workbench.
 */
describe('Workbench, full view', () => {
  it('offers full view on an open workbench and asks for it on click', () => {
    const onToggleFull = vi.fn();
    render(<Workbench tab="browser" onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" full={false} onToggleFull={onToggleFull} />);
    const button = screen.getByTestId('bench-full');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Full view');
    fireEvent.click(button);
    expect(onToggleFull).toHaveBeenCalledTimes(1);
  });

  it('fills the window in full view instead of keeping its dragged width', () => {
    render(<Workbench tab="browser" onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" full onToggleFull={vi.fn()} />);
    const aside = screen.getByRole('complementary', { name: 'Workbench' });
    expect(aside.classList.contains('bench--full')).toBe(true);
    expect(aside.style.width).toBe('');
    // Nothing beside it to resize against.
    expect(screen.queryByRole('separator', { name: 'Resize workbench' })).toBeNull();
    const button = screen.getByTestId('bench-full');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Exit full view');
  });

  it('has no full view toggle while collapsed', () => {
    render(<Workbench tab={null} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" full={false} onToggleFull={vi.fn()} />);
    expect(screen.queryByTestId('bench-full')).toBeNull();
  });
});

/**
 * The drag used to run to a fixed 860 px whatever the window: on a laptop the
 * chat beside it was crushed to a sliver, on a wide screen the browser stopped
 * short of the room there was. It now stops where the chat reaches its minimum.
 */
describe('Workbench, resizing', () => {
  it('stops the drag where the chat beside it would get narrower than its minimum', async () => {
    const { setRailWidth, CHAT_MIN_WIDTH } = await import('../lib/useRailWidth');
    setRailWidth(400);
    render(
      <div>
        <main data-testid="chat" />
        <Workbench tab="terminal" onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />
      </div>,
    );
    const aside = screen.getByRole('complementary', { name: 'Workbench' });
    const rect = (left: number, width: number) =>
      ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
    screen.getByTestId('chat').getBoundingClientRect = () => rect(0, 800);
    aside.getBoundingClientRect = () => rect(800, 400);

    const grip = screen.getByRole('separator', { name: 'Resize workbench' });
    fireEvent.pointerDown(grip, { clientX: 800 });
    // jsdom has no PointerEvent; a MouseEvent of the same type carries clientX.
    fireEvent(window, new MouseEvent('pointermove', { clientX: 0 }));
    fireEvent(window, new MouseEvent('pointerup'));

    expect(aside.style.width).toBe(`${400 + 800 - CHAT_MIN_WIDTH}px`);
    expect(grip.getAttribute('aria-valuemax')).toBe(String(400 + 800 - CHAT_MIN_WIDTH));
  });
});

describe('Workbench, the browser', () => {
  beforeEach(() => {
    browserLife.mounts = 0;
    browserLife.unmounts = 0;
  });

  const bench = (tab: 'terminal' | 'browser' | null) => (
    <Workbench tab={tab} onPick={vi.fn()} onClose={vi.fn()} workspaceId="ws" />
  );
  const shown = () => screen.getByTestId('pane-browser').closest('[data-shown]')?.getAttribute('data-shown');

  it('keeps its pages when the workbench is collapsed and opened again', () => {
    const { rerender } = render(bench('browser'));
    rerender(bench(null));
    expect(shown()).toBe('false');
    rerender(bench('browser'));

    expect(shown()).toBe('true');
    expect(browserLife).toEqual({ mounts: 1, unmounts: 0 });
  });

  it('keeps its pages while another pane is shown', () => {
    const { rerender } = render(bench('browser'));
    rerender(bench('terminal'));
    expect(screen.getByTestId('pane-terminal')).toBeTruthy();
    expect(shown()).toBe('false');
    rerender(bench('browser'));

    expect(browserLife).toEqual({ mounts: 1, unmounts: 0 });
  });

  it('is not started before it is first opened', () => {
    render(bench('terminal'));
    expect(screen.queryByTestId('pane-browser')).toBeNull();
  });
});

describe('workbenchTabForTool', () => {
  it('maps the surface-backed tools to their pane, and nothing else', () => {
    expect(workbenchTabForTool('terminal')).toBe('terminal');
    expect(workbenchTabForTool('browser_session')).toBe('browser');
    expect(workbenchTabForTool('Read')).toBeUndefined();
  });

  it('opens the browser for every browser tool, so a tab the agent asks for has a pane to open in', () => {
    for (const tool of ['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_batch']) {
      expect(workbenchTabForTool(tool)).toBe('browser');
    }
    expect(workbenchTabForTool('browser')).toBeUndefined();
  });
});
