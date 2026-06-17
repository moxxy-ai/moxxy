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
  render(<WorkspaceSidebar view="chat" onView={vi.fn()} />);
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
});
