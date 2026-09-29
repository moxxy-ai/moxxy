/**
 * useSurface frame gating:
 *   Frames must be dropped until our own surfaceId is known (open() resolved),
 *   otherwise a payload from a PREVIOUS instance — after a rapid close/reopen of
 *   the same workspace — could be written to the new surface before the id is
 *   set, producing stale / interleaved output. The open() snapshot covers any
 *   pre-attach state, so nothing is lost.
 */
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride, connectionStore } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { useSurface } from './useSurface';

const CONNECTED: ConnectionPhase = {
  phase: 'connected',
  socket: '/tmp/serve.sock',
  sessionId: 's',
  activeProvider: null,
  activeMode: null,
};
const STARTING: ConnectionPhase = { phase: 'spawning', cliPath: 'moxxy', socket: '/tmp/serve.sock' };

function setPhase(workspaceId: string, phase: ConnectionPhase): void {
  act(() => connectionStore.setSnapshot(workspaceId, { phase, cliPath: null, attempts: 0, log: [] }));
}

interface SurfaceData {
  readonly workspaceId: string;
  readonly data: { readonly surfaceId: string; readonly payload: unknown };
}

function installFakeApi(opts: {
  surfaceId: string;
  openDelayMs?: number;
}): {
  fireData: (d: SurfaceData) => void;
  resolveOpen: () => void;
} {
  let dataCb: ((d: SurfaceData) => void) | null = null;
  let releaseOpen: (() => void) | null = null;
  __setApiOverride({
    invoke: ((channel: string) => {
      if (channel === 'surface.open') {
        // Defer resolution until the test releases it, so we can deliver frames
        // during the open window (before surfaceIdRef is set).
        return new Promise((resolve) => {
          releaseOpen = () => resolve({ surfaceId: opts.surfaceId });
        });
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((event: string, cb: (d: SurfaceData) => void) => {
      if (event === 'surface.data') dataCb = cb;
      return () => {
        dataCb = null;
      };
    }) as never,
  } as never);
  return {
    fireData: (d) => dataCb?.(d),
    resolveOpen: () => releaseOpen?.(),
  };
}

afterEach(async () => {
  // Unmount (firing useSurface's async surface.close) while the fake transport
  // is still installed, then yield a microtask so that close lands before we
  // tear the override down — otherwise the deferred cleanup hits a missing
  // transport.
  cleanup();
  await Promise.resolve();
  __setApiOverride(null);
});

describe('useSurface frame gating', () => {
  beforeEach(() => setPhase('ws-1', CONNECTED));

  it('drops frames that arrive before open() resolves (id unknown)', async () => {
    const fake = installFakeApi({ surfaceId: 'surf-NEW' });
    const onData = vi.fn();
    renderHook(() => useSurface('ws-1', 'browser', { onData }));

    // A frame from a STALE/previous instance arrives during the open window —
    // surfaceIdRef is still null, so it must be dropped, not delivered.
    fake.fireData({ workspaceId: 'ws-1', data: { surfaceId: 'surf-OLD', payload: { a: 1 } } });
    expect(onData).not.toHaveBeenCalled();

    fake.resolveOpen();
    await waitFor(() => undefined);

    // Foreign-id frames stay dropped even after open resolves.
    fake.fireData({ workspaceId: 'ws-1', data: { surfaceId: 'surf-OLD', payload: { b: 2 } } });
    expect(onData).not.toHaveBeenCalled();

    // Our own id is delivered.
    fake.fireData({ workspaceId: 'ws-1', data: { surfaceId: 'surf-NEW', payload: { c: 3 } } });
    await waitFor(() => expect(onData).toHaveBeenCalledWith({ c: 3 }));
  });

  it('ignores frames for a different workspace', async () => {
    const fake = installFakeApi({ surfaceId: 'surf-NEW' });
    const onData = vi.fn();
    renderHook(() => useSurface('ws-1', 'browser', { onData }));
    fake.resolveOpen();
    await waitFor(() => undefined);

    fake.fireData({ workspaceId: 'ws-OTHER', data: { surfaceId: 'surf-NEW', payload: { x: 1 } } });
    expect(onData).not.toHaveBeenCalled();
  });
});

/** A host whose runner answers `surface.open` like the real one: only once the
 *  workspace's runner is connected, otherwise "not connected to a runner". */
function installRunnerHost(): { opens: () => number; runnerUp: (up: boolean) => void } {
  let up = false;
  let opens = 0;
  __setApiOverride({
    invoke: ((channel: string) => {
      if (channel !== 'surface.open') return Promise.resolve(undefined);
      if (!up) return Promise.reject(new Error('not connected to a runner'));
      opens += 1;
      return Promise.resolve({ surfaceId: `surf-${opens}` });
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return { opens: () => opens, runnerUp: (next) => (up = next) };
}

describe('useSurface and the workspace runner', () => {
  it('opens the surface once a still-starting runner connects, without an error in between', async () => {
    const host = installRunnerHost();
    setPhase('ws-starting', STARTING);
    const { result } = renderHook(() => useSurface('ws-starting', 'terminal', { onData: vi.fn() }));
    await act(async () => undefined);

    host.runnerUp(true);
    setPhase('ws-starting', CONNECTED);

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('opens a fresh surface when the runner comes back after a reconnect', async () => {
    const host = installRunnerHost();
    host.runnerUp(true);
    setPhase('ws-restart', CONNECTED);
    const { result } = renderHook(() => useSurface('ws-restart', 'terminal', { onData: vi.fn() }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    host.runnerUp(false);
    setPhase('ws-restart', { phase: 'reconnecting', reason: 'exited', attempt: 1 });
    expect(result.current.ready).toBe(false);
    host.runnerUp(true);
    setPhase('ws-restart', CONNECTED);

    await waitFor(() => expect(host.opens()).toBe(2));
    expect(result.current.ready).toBe(true);
  });
});
