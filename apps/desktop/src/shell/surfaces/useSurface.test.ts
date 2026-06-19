/**
 * useSurface frame gating:
 *   Frames must be dropped until our own surfaceId is known (open() resolved),
 *   otherwise a payload from a PREVIOUS instance — after a rapid close/reopen of
 *   the same workspace — could be written to the new surface before the id is
 *   set, producing stale / interleaved output. The open() snapshot covers any
 *   pre-attach state, so nothing is lost.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { useSurface } from './useSurface';

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
