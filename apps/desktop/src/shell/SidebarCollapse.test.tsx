/**
 * Sidebar collapse/expand:
 *   1. The rail's collapse button hides the whole sidebar and surfaces
 *      the expand affordance in the main-pane header (`ViewHeader`).
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
import { ViewHeader } from './ViewHeader';
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
      <WorkspaceSidebar view="chat" onView={vi.fn()} />
      <ViewHeader>
        <span>header content</span>
      </ViewHeader>
    </>,
  );
}

beforeEach(() => {
  // The collapsed flag is a module singleton — reset it (and storage)
  // so tests don't leak into each other.
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
});

describe('sidebar collapse', () => {
  it('starts expanded: sidebar visible, no expand button in the header', () => {
    renderShell();
    expect(screen.getByTestId('sidebar-collapse')).toBeTruthy();
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-expand')).toBeNull();
  });

  it('collapse hides the sidebar, shows the header expand button, persists', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    // The whole rail is gone (width 0 — it renders nothing)…
    expect(screen.queryByTestId('nav-settings')).toBeNull();
    expect(screen.queryByTestId('sidebar-collapse')).toBeNull();
    // …and the main-pane header now carries the way back.
    expect(screen.getByTestId('sidebar-expand')).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('expand restores the sidebar and clears the persisted flag', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    fireEvent.click(screen.getByTestId('sidebar-expand'));
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-expand')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('collapsed state survives a "restart" (store re-read from localStorage)', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    reloadSidebarCollapsedFromStorage();
    renderShell();
    expect(screen.queryByTestId('nav-settings')).toBeNull();
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
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
  });
});
