import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { reloadSidebarCollapsedFromStorage } from '@/lib/useSidebarCollapsed';
import { WorkspaceSidebar } from './WorkspaceSidebar';

const mocks = vi.hoisted(() => ({
  desksApi: {} as Record<string, unknown>,
  renameSession: vi.fn(),
  removeSession: vi.fn(),
  setActiveSession: vi.fn(),
}));

vi.mock('@moxxy/client-core', () => ({
  useDesks: () => mocks.desksApi,
  useUnreadWorkspaces: () => [],
  chatStore: { subscribe: () => () => undefined, getChat: () => ({ events: [], sending: false, activeTurnId: null }) },
  usePrefs: () => ({ prefs: null, loading: false, update: vi.fn() }),
}));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: null, isLoaded: true }),
  useAuth: () => ({ sessionClaims: null }),
  useClerk: () => ({ openSignIn: vi.fn() }),
}));

function makeDesk(): Desk {
  return {
    id: 'desk-1',
    name: 'Tata',
    cwd: '/tmp/tata',
    color: '#ef4444',
    createdAt: 1,
    activeSessionId: 'session-2',
    sessions: [
      { id: 'session-1', name: 'cześć', createdAt: 1 },
      { id: 'session-2', name: 'hejo', createdAt: 2 },
    ],
  };
}

function renderSidebar(): void {
  render(<WorkspaceSidebar onOpenRun={vi.fn()} />);
}

beforeEach(() => {
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
  mocks.renameSession.mockReset().mockResolvedValue(undefined);
  mocks.removeSession.mockReset().mockResolvedValue(undefined);
  mocks.setActiveSession.mockReset().mockResolvedValue(undefined);
  mocks.desksApi = {
    desks: [makeDesk()],
    activeId: 'desk-1',
    loading: false,
    pickFolder: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    remove: vi.fn(),
    createSession: vi.fn(),
    setActiveSession: mocks.setActiveSession,
    renameSession: mocks.renameSession,
    removeSession: mocks.removeSession,
    rename: vi.fn(),
  };
});

describe('WorkspaceSidebar session actions', () => {
  it('opens a rename modal and commits the trimmed session name from the form', () => {
    renderSidebar();

    fireEvent.click(screen.getByLabelText('session actions hejo'));
    fireEvent.click(screen.getByLabelText('rename session hejo'));

    expect(screen.getByRole('dialog', { name: 'Rename session' })).toBeTruthy();
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('hejo');

    fireEvent.change(input, { target: { value: '  Plan na auta  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(mocks.renameSession).toHaveBeenCalledWith('session-2', 'Plan na auta');
    expect(mocks.setActiveSession).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting a session', () => {
    renderSidebar();

    fireEvent.click(screen.getByLabelText('session actions hejo'));
    fireEvent.click(screen.getByLabelText('remove session hejo'));

    const dialog = screen.getByRole('dialog', { name: 'Delete session?' });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByText(/hejo/)).toBeTruthy();
    expect(mocks.removeSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mocks.removeSession).toHaveBeenCalledWith('session-2');
  });

  it('filters the runs from the search field, and says when nothing matches', () => {
    renderSidebar();

    // Always there, like a messenger's: no toggle to find first.
    const field = screen.getByTestId('workspace-search') as HTMLInputElement;

    // A session match keeps its workspace visible with only that session under it.
    fireEvent.change(field, { target: { value: 'hejo' } });
    expect(screen.getByTestId('session-row-session-2')).toBeTruthy();
    expect(screen.queryByTestId('session-row-session-1')).toBeNull();

    // Nothing matching is a STATE. A blank column would read as "no workspaces".
    fireEvent.change(field, { target: { value: 'zzzz-no-match' } });
    expect(screen.queryByTestId('session-row-session-2')).toBeNull();
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();

    // Escape clears the filter and restores the full list.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('');
    expect(screen.getByTestId('session-row-session-1')).toBeTruthy();
  });

  it('starts a new run in the current workspace from the sidebar head', async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('session-new'));
    expect(mocks.desksApi.createSession).toHaveBeenCalledWith('desk-1');
  });

  it('starts a new workspace from the end of the list', () => {
    // Rare next to starting a run, so it is a quiet row under the list rather
    // than a button in the head.
    renderSidebar();

    const plus = screen.getByTestId('workspace-new');
    expect(plus).toBeTruthy();
    fireEvent.click(plus);

    expect(mocks.desksApi.pickFolder).toHaveBeenCalled();
  });
});
