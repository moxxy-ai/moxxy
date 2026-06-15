import { act, renderHook, waitFor } from '@testing-library/react';
import type { Desk, DesksOverview, IpcEvents, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __setApiOverride } from './transport';
import { connectionStore } from './useConnection';
import { __resetDesksStoreForTests, useDesks } from './useDesks';

type EventHandler<K extends keyof IpcEvents> = (payload: IpcEvents[K]) => void;

function fakeApi(initial: DesksOverview): {
  setOverview: (next: DesksOverview) => void;
  emit: <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) => void;
  invoke: ReturnType<typeof vi.fn>;
} {
  let overview = initial;
  const handlers = new Map<keyof IpcEvents, EventHandler<keyof IpcEvents>>();
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'desks.list') return overview;
    throw new Error(`unexpected ${cmd}`);
  });
  const api: MoxxyApi = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((channel: keyof IpcEvents, handler: EventHandler<keyof IpcEvents>) => {
      handlers.set(channel, handler);
      return () => handlers.delete(channel);
    }) as MoxxyApi['subscribe'],
  };
  __setApiOverride(api);
  return {
    setOverview: (next) => {
      overview = next;
    },
    emit: (channel, payload) => {
      handlers.get(channel)?.(payload);
    },
    invoke,
  };
}

afterEach(() => {
  act(() => {
    __resetDesksStoreForTests();
    connectionStore.setActive(null);
  });
  __setApiOverride(null);
});

describe('useDesks', () => {
  it('updates from desks.changed broadcasts without a manual refresh', async () => {
    const host = fakeApi({ desks: [], activeId: null });
    const { result } = renderHook(() => useDesks());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.desks).toEqual([]);

    const desk: Desk = {
      id: 'moxxy',
      name: 'Moxxy',
      cwd: '/tmp/.moxxy/workspaces/moxxy',
      color: '#ec4899',
      createdAt: 1,
      activeSessionId: 's1',
      sessions: [{ id: 's1', name: 'from tui', createdAt: 1, eventCount: 2 }],
    };
    const next = { desks: [desk], activeId: 'moxxy' };
    host.setOverview(next);
    act(() => {
      host.emit('desks.changed', next);
    });

    expect(result.current.desks).toEqual([desk]);
    expect(result.current.activeId).toBe('moxxy');
  });

  it('seeds the active connection from the initial active desk session', async () => {
    const desk: Desk = {
      id: 'desk-a',
      name: 'Desk A',
      cwd: '/repo',
      color: '#3b82f6',
      createdAt: 1,
      activeSessionId: 'session-active',
      sessions: [
        { id: 'session-old', name: 'Old', createdAt: 1 },
        { id: 'session-active', name: 'Active', createdAt: 2 },
      ],
    };
    fakeApi({ desks: [desk], activeId: 'desk-a' });

    const { result } = renderHook(() => useDesks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(connectionStore.active$()).toBe('session-active');
  });

  it('renames a session in the sidebar store immediately while the host refresh is pending', async () => {
    let resolveRename: ((value: unknown) => void) | null = null;
    const desk: Desk = {
      id: 'desk-a',
      name: 'Desk A',
      cwd: '/repo',
      color: '#3b82f6',
      createdAt: 1,
      activeSessionId: 'session-a',
      sessions: [{ id: 'session-a', name: 'Old name', createdAt: 1 }],
    };
    const host = fakeApi({ desks: [desk], activeId: 'desk-a' });
    const renamedDesk: Desk = {
      ...desk,
      sessions: [{ id: 'session-a', name: 'New name', createdAt: 1 }],
    };
    host.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'desks.list') return Promise.resolve({ desks: [desk], activeId: 'desk-a' });
      if (cmd === 'sessions.rename') {
        return new Promise((resolve) => {
          resolveRename = resolve;
        });
      }
      throw new Error(`unexpected ${cmd}`);
    });

    const { result } = renderHook(() => useDesks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let renamePromise: Promise<void> | null = null;
    act(() => {
      renamePromise = result.current.renameSession('session-a', 'New name');
    });

    expect(result.current.desks[0]?.sessions[0]?.name).toBe('New name');
    expect(resolveRename).not.toBeNull();

    host.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'desks.list') return Promise.resolve({ desks: [renamedDesk], activeId: 'desk-a' });
      if (cmd === 'sessions.rename') return Promise.resolve(renamedDesk.sessions[0]);
      throw new Error(`unexpected ${cmd}`);
    });
    act(() => {
      resolveRename?.({ id: 'session-a', name: 'New name', createdAt: 1 });
    });
    await act(async () => {
      await renamePromise;
    });
    expect(result.current.desks[0]?.sessions[0]?.name).toBe('New name');
  });
});
