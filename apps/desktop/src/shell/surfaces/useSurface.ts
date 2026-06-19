import { useEffect, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import type { SurfaceInputMessage, SurfaceSize } from '@moxxy/sdk';

export interface SurfaceControls {
  /** Open + ready (the runner returned a surfaceId). */
  readonly ready: boolean;
  /** Surface failed to open (e.g. runner predates v8 / no plugin). */
  readonly error: string | null;
  /** Send a viewer input message to the surface. No-op until ready. */
  readonly input: (message: SurfaceInputMessage) => void;
  /** Resize the surface viewport. No-op until ready. */
  readonly resize: (size: SurfaceSize) => void;
}

/**
 * Open a runner-owned surface (terminal / browser) for a workspace and stream
 * its frames. `onSnapshot` fires once with the catch-up state; `onData` fires
 * per live frame. Opening is idempotent on the runner, so re-mounting attaches
 * to the shared instance. Closes (detaches the viewer) on unmount.
 */
export function useSurface(
  workspaceId: string | null,
  kind: string,
  handlers: {
    readonly onSnapshot?: (snapshot: unknown) => void;
    readonly onData: (payload: unknown) => void;
  },
): SurfaceControls {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surfaceIdRef = useRef<string | null>(null);
  // Keep handler identity out of the effect deps so a parent re-render doesn't
  // re-open the surface.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    setReady(false);
    setError(null);
    surfaceIdRef.current = null;

    // Live frames for THIS workspace's matching surface instance. Drop frames
    // until our surfaceId is known (open hasn't resolved yet): otherwise a
    // payload from a PREVIOUS instance — e.g. after a rapid close/reopen of the
    // same workspace — could be written to the new terminal/browser before the
    // id is set, producing stale or interleaved output. The open() snapshot
    // covers any pre-attach state, so nothing is lost by dropping these.
    const unsub = api().subscribe('surface.data', ({ workspaceId: wid, data }) => {
      if (disposed || wid !== workspaceId) return;
      if (!surfaceIdRef.current || data.surfaceId !== surfaceIdRef.current) return;
      handlersRef.current.onData(data.payload);
    });

    void (async () => {
      try {
        const res = await api().invoke('surface.open', { workspaceId, kind });
        if (disposed) {
          void api().invoke('surface.close', { workspaceId, surfaceId: res.surfaceId }).catch(() => {});
          return;
        }
        surfaceIdRef.current = res.surfaceId;
        if (res.snapshot !== undefined) handlersRef.current.onSnapshot?.(res.snapshot);
        setReady(true);
      } catch (err) {
        if (!disposed) setError(toErrorMessage(err));
      }
    })();

    return () => {
      disposed = true;
      unsub();
      const id = surfaceIdRef.current;
      if (id) {
        void api().invoke('surface.close', { workspaceId, surfaceId: id }).catch(() => {});
      }
    };
  }, [workspaceId, kind]);

  const input = (message: SurfaceInputMessage): void => {
    const id = surfaceIdRef.current;
    if (!id || !workspaceId) return;
    void api().invoke('surface.input', { workspaceId, surfaceId: id, message }).catch(() => {});
  };
  const resize = (size: SurfaceSize): void => {
    const id = surfaceIdRef.current;
    if (!id || !workspaceId) return;
    void api().invoke('surface.resize', { workspaceId, surfaceId: id, size }).catch(() => {});
  };

  return { ready, error, input, resize };
}
