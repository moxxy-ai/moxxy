import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ConnectionPhase, ConnectionSnapshot } from '@shared/ipc';

/**
 * Subscribes to the supervisor's `connection.changed` stream and
 * also fetches a one-shot snapshot on mount so late mounts don't
 * miss the initial phase.
 */
export interface UseConnection {
  readonly snapshot: ConnectionSnapshot | null;
  /** Sticky flag: true the moment we first land on `connected` and
   *  never flips back. Lets the UI distinguish a cold-start "we have
   *  never connected" (show full ConnectionScreen) from a transient
   *  reconnect after a workspace switch (keep the shell, show a
   *  banner). */
  readonly hasEverConnected: boolean;
  readonly retry: () => Promise<void>;
}

export function useConnection(): UseConnection {
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot | null>(null);
  const [hasEverConnected, setHasEverConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void api()
      .invoke('connection.snapshot')
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        if (s.phase.phase === 'connected') setHasEverConnected(true);
      })
      .catch(() => {
        /* preload missing — leave null */
      });

    const unsub = api().subscribe('connection.changed', (phase: ConnectionPhase) => {
      if (phase.phase === 'connected') setHasEverConnected(true);
      setSnapshot((prev) => {
        if (prev) return { ...prev, phase };
        return {
          phase,
          cliPath: null,
          attempts: 0,
          log: [],
        };
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const retry = useCallback(async () => {
    try {
      await api().invoke('connection.retry');
    } catch {
      /* best-effort */
    }
  }, []);

  return { snapshot, hasEverConnected, retry };
}

export function isConnected(phase: ConnectionPhase | undefined): boolean {
  return phase?.phase === 'connected';
}
