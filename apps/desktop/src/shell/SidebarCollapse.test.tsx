/**
 * Sidebar collapse/expand:
 *   1. The rail's collapse button hides the whole sidebar and surfaces
 *      the expand affordance in the instrument bar (`InstrumentBar`).
 *   2. The expand button restores the rail and disappears again.
 *   3. State persists via localStorage (`moxxy.sidebarCollapsed`) — a
 *      "restart" (store re-read) comes back collapsed.
 *
 * WorkspaceSidebar's data hooks (client-core) and ProfilePill's Clerk
 * hooks are mocked — this suite only cares about the shell chrome.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { InstrumentBar } from './InstrumentBar';
import {
  INDEX_MAX_WIDTH,
  INDEX_MIN_WIDTH,
  reloadIndexWidthFromStorage,
} from '@/lib/useIndexWidth';
import {
  reloadSidebarCollapsedFromStorage,
  setSidebarCollapsed,
  toggleSidebarCollapsed,
} from '@/lib/useSidebarCollapsed';

vi.mock('@moxxy/client-core', () => ({
  useDesks: () => ({
    desks: [],
    activeId: null,
    loading: false,
    pickFolder: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    remove: vi.fn(),
  }),
  useSessions: () => ({
    sessions: [],
    activeSessionId: null,
    create: vi.fn(),
    setActive: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }),
  useUnreadWorkspaces: () => [],
  usePrefs: () => ({ prefs: null, loading: false, update: vi.fn() }),
}));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: null, isLoaded: true }),
  useAuth: () => ({ sessionClaims: null }),
  useClerk: () => ({ openSignIn: vi.fn() }),
}));

const STORAGE_KEY = 'moxxy.sidebarCollapsed';

function renderShell(): void {
  render(
    <>
      <WorkspaceSidebar onOpenRun={vi.fn()} />
      <InstrumentBar crumbs={['blocky', 'a run']}>
        <span>header content</span>
      </InstrumentBar>
    </>,
  );
}

beforeEach(() => {
  // The collapsed flag is a module singleton — reset it (and storage)
  // so tests don't leak into each other.
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
  reloadIndexWidthFromStorage();
});

describe('sidebar collapse', () => {
  it('starts expanded: sidebar visible, no expand button in the header', () => {
    renderShell();
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.queryByTestId('sidebar-expand')).toBeNull();
  });

  it('collapse hides the sidebar, shows the header expand button, persists', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    // The column stays MOUNTED so its width can animate (a thing that is not in
    // the DOM cannot ease), so "collapsed" is no longer "absent from the DOM" —
    // it is "zero width and out of reach". Both halves matter: zero width alone
    // would leave its buttons focusable.
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('index-column')).toHaveAttribute('aria-hidden', 'true');
    // …and the main-pane header now carries the way back.
    expect(screen.getByTestId('sidebar-expand')).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('expand restores the sidebar and clears the persisted flag', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    fireEvent.click(screen.getByTestId('sidebar-expand'));
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'false');
    expect(screen.queryByTestId('sidebar-expand')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('collapsed state survives a "restart" (store re-read from localStorage)', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    reloadSidebarCollapsedFromStorage();
    renderShell();
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('sidebar-expand')).toBeTruthy();
  });

  it('toggle flips state both ways (the Cmd/Ctrl+B handler calls this)', () => {
    renderShell();
    act(() => toggleSidebarCollapsed());
    expect(screen.getByTestId('sidebar-expand')).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    act(() => toggleSidebarCollapsed());
    expect(screen.queryByTestId('sidebar-expand')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Direct set to the current value is a no-op.
    act(() => setSidebarCollapsed(false));
    expect(screen.getByTestId('index-column')).toHaveAttribute('data-collapsed', 'false');
  });

  it('is keyboard-resizable, clamped, and remembers the width', () => {
    renderShell();
    const grip = screen.getByTestId('index-resize');
    const column = screen.getByTestId('index-column');
    const widthOf = (): number => Number(grip.getAttribute('aria-valuenow'));

    const start = widthOf();
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(widthOf()).toBe(start + 16);
    fireEvent.keyDown(grip, { key: 'ArrowRight', shiftKey: true });
    expect(widthOf()).toBe(start + 56);
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(widthOf()).toBe(start + 40);

    // Clamped at both ends: the floor is set by content (an LED, a name and a
    // time reading need room to be readable), the ceiling stops the index from
    // eating the field it indexes.
    fireEvent.keyDown(grip, { key: 'Home' });
    expect(widthOf()).toBe(INDEX_MIN_WIDTH);
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(widthOf()).toBe(INDEX_MIN_WIDTH);
    fireEvent.keyDown(grip, { key: 'End' });
    expect(widthOf()).toBe(INDEX_MAX_WIDTH);
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    expect(widthOf()).toBe(INDEX_MAX_WIDTH);

    expect(column.style.width).toBe(`${INDEX_MAX_WIDTH}px`);
    expect(window.localStorage.getItem('moxxy.indexWidth')).toBe(String(INDEX_MAX_WIDTH));
  });

  it('has no resize grip while collapsed — there is no edge to drag', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.queryByTestId('index-resize')).toBeNull();
  });
});
