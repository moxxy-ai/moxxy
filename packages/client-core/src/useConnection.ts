import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, getTransportRevision, subscribeTransport } from './transport.js';
import { createListenerSet } from './externalStore.js';
import type { ConnectionPhase, ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { isRunnerLoadingPhase } from './useSessionInfoReady.js';

const CONNECTION_LOADING_RESYNC_MS = 750;

/**
 * Module-level store of every supervised workspace's connection
 * phase. The main process pushes one `connection.changed` per
 * workspace; the renderer routes by id. The active workspace is
 * tracked separately because it changes via user action, not via
 * IPC.
 */
class ConnectionStore {
  private snapshots = new Map<string, ConnectionSnapshot>();
  private active: string | null = null;
  private hasEverConnected = false;
  private readonly listeners = createListenerSet();

  subscribe = this.listeners.subscribe;

  private emit(): void {
    this.listeners.emit();
  }

  setSnapshot(workspaceId: string, snapshot: ConnectionSnapshot): void {
    this.snapshots.set(workspaceId, snapshot);
    if (snapshot.phase.phase === 'connected') this.hasEverConnected = true;
    this.emit();
  }

  setActive(workspaceId: string | null): void {
    if (this.active === workspaceId) return;
    this.active = workspaceId;
    this.emit();
  }

  get(workspaceId: string | null): ConnectionSnapshot | null {
    if (!workspaceId) return null;
    return this.snapshots.get(workspaceId) ?? null;
  }

  active$(): string | null {
    return this.active;
  }

  hasEver(): boolean {
    return this.hasEverConnected;
  }
}

export const connectionStore = new ConnectionStore();

export interface UseConnection {
  readonly snapshot: ConnectionSnapshot | null;
  readonly hasEverConnected: boolean;
  readonly retry: () => Promise<void>;
}

/**
 * Bridge component — primes the connection store on mount from
 * `connection.snapshotAll` and subscribes to per-workspace phase
 * changes. Render at the top of the React tree, like
 * {@link ChatStoreBridge}.
 */
export function ConnectionBridge(): null {
  const transportRevision = useSyncExternalStore(subscribeTransport, getTransportRevision);

  useEffect(() => {
    let cancelled = false;
    let loadingResync: ReturnType<typeof setTimeout> | null = null;

    const clearLoadingResync = (): void => {
      if (loadingResync !== null) clearTimeout(loadingResync);
      loadingResync = null;
    };

    const applySnapshot = (
      workspaceId: string,
      phase: ConnectionPhase,
    ): void => {
      const prev = connectionStore.get(workspaceId);
      connectionStore.setSnapshot(workspaceId, {
        phase,
        // Prefer values carried by the fresh phase over the previous
        // snapshot — otherwise a rapid reconnect (where snapshotAll hasn't
        // re-primed) shows a stale cliPath / attempt count. `log` only ever
        // arrives via snapshotAll, so it still falls back to prev.
        cliPath: 'cliPath' in phase ? phase.cliPath : (prev?.cliPath ?? null),
        attempts: phase.phase === 'reconnecting' ? phase.attempt : (prev?.attempts ?? 0),
        log: prev?.log ?? [],
      });
    };

    const scheduleLoadingResync = (): void => {
      if (cancelled || loadingResync !== null) return;
      loadingResync = setTimeout(() => {
        loadingResync = null;
        void refreshConnectionState();
      }, CONNECTION_LOADING_RESYNC_MS);
    };

    const resyncIfActiveStillLoading = (): void => {
      const active = connectionStore.active$();
      if (!active) return;
      const activeSnapshot = connectionStore.get(active);
      if (!activeSnapshot || isRunnerLoadingPhase(activeSnapshot.phase)) {
        scheduleLoadingResync();
      } else {
        clearLoadingResync();
      }
    };

    const refreshConnectionState = async (): Promise<void> => {
      try {
        const snapshots = await api().invoke('connection.snapshotAll');
        if (cancelled) return;
        for (const s of snapshots) {
          const { workspaceId, ...snapshot } = s;
          connectionStore.setSnapshot(workspaceId, snapshot);
        }
      } catch {
        /* preload missing */
      }
      try {
        const id = await api().invoke('connection.activeWorkspace');
        if (!cancelled) connectionStore.setActive(id);
      } catch {
        /* preload missing */
      }
      if (!cancelled) resyncIfActiveStillLoading();
    };

    const unsub = api().subscribe(
      'connection.changed',
      // payload type is inferred from the channel literal via SubscribeFn.
      ({ workspaceId, phase }) => {
        applySnapshot(workspaceId, phase);
        resyncIfActiveStillLoading();
      },
    );
    void refreshConnectionState();

    return () => {
      cancelled = true;
      clearLoadingResync();
      unsub();
    };
  }, [transportRevision]);

  return null;
}

export function useConnection(workspaceId: string | null): UseConnection {
  const snapshot = useSyncExternalStore(
    connectionStore.subscribe,
    () => connectionStore.get(workspaceId),
  );
  const hasEverConnected = useSyncExternalStore(
    connectionStore.subscribe,
    () => connectionStore.hasEver(),
  );

  const retry = useCallback(async () => {
    try {
      await api().invoke(
        'connection.retry',
        workspaceId ? { workspaceId } : undefined,
      );
    } catch {
      /* best-effort */
    }
  }, [workspaceId]);

  return { snapshot, hasEverConnected, retry };
}

/** Active workspace id maintained by the connection bridge. */
export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(connectionStore.subscribe, () =>
    connectionStore.active$(),
  );
}

export function isConnected(phase: ConnectionPhase | undefined): boolean {
  return phase?.phase === 'connected';
}
