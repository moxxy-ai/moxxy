/**
 * useSessions store tests — drive the IPC surface through the fake api
 * shim and assert the session list, the optimistic local-first switch
 * (connectionStore.setActive BEFORE the IPC lands + rollback on
 * failure), and the post-remove re-point onto the host's promoted
 * session.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { connectionStore } from './useConnection.js';
import { sessionsStore, useSessions } from './useSessions.js';
import type { DeskSession, MoxxyApi, SessionsOverview } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

const s1: DeskSession = { id: 's1', name: 'Session 1', createdAt: 1 };
const s2: DeskSession = { id: 's2', name: 'Session 2', createdAt: 2 };

/** A fake host: one desk ('d1') whose sessions live in `state`. Also
 *  answers the desks.list refresh the store fires after mutations. */
function installHost(initial: SessionsOverview): {
  invokes: Array<{ cmd: string; args: unknown }>;
  state: { overview: SessionsOverview };
} {
  const invokes: Array<{ cmd: string; args: unknown }> = [];
  const state = { overview: initial };
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    invokes.push({ cmd, args });
    switch (cmd) {
      case 'sessions.list':
        return state.overview;
      case 'sessions.create': {
        const created: DeskSession = { id: 'new', name: 'Session N', createdAt: 9 };
        state.overview = {
          ...state.overview,
          sessions: [...state.overview.sessions, created],
        };
        return created;
      }
      case 'sessions.setActive':
        state.overview = {
          ...state.overview,
          activeSessionId: (args as { id: string }).id,
        };
        return undefined;
      case 'sessions.remove': {
        const id = (args as { id: string }).id;
        const left = state.overview.sessions.filter((s) => s.id !== id);
        state.overview = {
          sessions: left,
          activeSessionId:
            state.overview.activeSessionId === id
              ? (left[0]?.id ?? null)
              : state.overview.activeSessionId,
        };
        return undefined;
      }
      case 'sessions.rename':
        return undefined;
      case 'desks.list':
        return { desks: [], activeId: null };
      default:
        throw new Error(`unexpected ${cmd}`);
    }
  });
  __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));
  return { invokes, state };
}

afterEach(() => {
  // Reset the module-level singletons between tests.
  act(() => {
    sessionsStore.setDesk(null);
    connectionStore.setActive(null);
  });
  __setApiOverride(null);
});

describe('useSessions', () => {
  it('loads the desk\'s sessions on mount and reloads on desk switch', async () => {
    const { invokes } = installHost({ sessions: [s1, s2], activeSessionId: 's1' });
    const { result, rerender } = renderHook(({ deskId }) => useSessions(deskId), {
      initialProps: { deskId: 'd1' as string | null },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toEqual([s1, s2]);
    expect(result.current.activeSessionId).toBe('s1');
    expect(invokes).toContainEqual({ cmd: 'sessions.list', args: { deskId: 'd1' } });

    rerender({ deskId: 'd2' });
    await waitFor(() =>
      expect(invokes).toContainEqual({ cmd: 'sessions.list', args: { deskId: 'd2' } }),
    );
  });

  it('clears to the empty state when the desk goes null', async () => {
    installHost({ sessions: [s1], activeSessionId: 's1' });
    const { result, rerender } = renderHook(({ deskId }) => useSessions(deskId), {
      initialProps: { deskId: 'd1' as string | null },
    });
    await waitFor(() => expect(result.current.sessions).toEqual([s1]));
    rerender({ deskId: null });
    await waitFor(() => expect(result.current.sessions).toEqual([]));
    expect(result.current.loading).toBe(false);
  });

  it('setActive flips connectionStore BEFORE the IPC lands (optimistic, local-first)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const overview: SessionsOverview = { sessions: [s1, s2], activeSessionId: 's1' };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sessions.list') return overview;
      if (cmd === 'sessions.setActive') {
        await gate; // hold the IPC open so we can observe the optimistic flip
        return undefined;
      }
      if (cmd === 'desks.list') return { desks: [], activeId: null };
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useSessions('d1'));
    await waitFor(() => expect(result.current.sessions).toEqual([s1, s2]));

    let done: Promise<void>;
    act(() => {
      done = result.current.setActive('s2');
    });
    // The switch is already visible while the host call is still in flight.
    expect(connectionStore.active$()).toBe('s2');
    expect(result.current.activeSessionId).toBe('s2');
    release();
    await act(async () => done);
  });

  it('setActive rolls back the optimistic flip when the IPC fails', async () => {
    const overview: SessionsOverview = { sessions: [s1, s2], activeSessionId: 's1' };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'sessions.list') return overview;
      if (cmd === 'sessions.setActive') throw new Error('boom');
      if (cmd === 'desks.list') return { desks: [], activeId: null };
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));
    connectionStore.setActive('s1');

    const { result } = renderHook(() => useSessions('d1'));
    await waitFor(() => expect(result.current.sessions).toEqual([s1, s2]));
    await act(async () => result.current.setActive('s2'));
    expect(result.current.activeSessionId).toBe('s1');
    expect(connectionStore.active$()).toBe('s1');
    expect(result.current.error).toBe('boom');
  });

  it('create invokes sessions.create for the tracked desk and refreshes', async () => {
    const { invokes } = installHost({ sessions: [s1], activeSessionId: 's1' });
    const { result } = renderHook(() => useSessions('d1'));
    await waitFor(() => expect(result.current.sessions).toEqual([s1]));
    let created: DeskSession | null = null;
    await act(async () => {
      created = await result.current.create();
    });
    expect(created).toMatchObject({ id: 'new' });
    expect(invokes).toContainEqual({ cmd: 'sessions.create', args: { deskId: 'd1' } });
    await waitFor(() => expect(result.current.sessions.map((s) => s.id)).toContain('new'));
  });

  it('remove re-points the connection store at the host\'s promoted session', async () => {
    installHost({ sessions: [s1, s2], activeSessionId: 's2' });
    connectionStore.setActive('s2');
    const { result } = renderHook(() => useSessions('d1'));
    await waitFor(() => expect(result.current.sessions).toEqual([s1, s2]));
    await act(async () => result.current.remove('s2'));
    expect(result.current.sessions).toEqual([s1]);
    expect(result.current.activeSessionId).toBe('s1');
    expect(connectionStore.active$()).toBe('s1');
  });

  it('rename invokes sessions.rename and surfaces errors via state', async () => {
    const { invokes } = installHost({ sessions: [s1], activeSessionId: 's1' });
    const { result } = renderHook(() => useSessions('d1'));
    await waitFor(() => expect(result.current.sessions).toEqual([s1]));
    await act(async () => result.current.rename('s1', 'Deep dive'));
    expect(invokes).toContainEqual({
      cmd: 'sessions.rename',
      args: { id: 's1', name: 'Deep dive' },
    });
    expect(result.current.error).toBeNull();
  });
});
