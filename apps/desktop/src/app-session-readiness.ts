import { useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

const SESSION_INFO_READY_RETRY_MS = 250;

interface ReadySessionInfoShape {
  readonly providers: ReadonlyArray<unknown>;
  readonly modes: ReadonlyArray<unknown>;
}

interface SessionInfoReadyState {
  readonly key: string | null;
  readonly ready: boolean;
}

export function isSessionInfoReady<T extends ReadySessionInfoShape>(
  info: T | null | undefined,
): info is T {
  return info !== null && info !== undefined && info.providers.length > 0 && info.modes.length > 0;
}

export function useSessionInfoReady(
  workspaceId: string | null,
  phase: ConnectionPhase | undefined,
): boolean {
  const readyKey = sessionInfoReadyKey(workspaceId, phase);
  const [state, setState] = useState<SessionInfoReadyState>({
    key: null,
    ready: false,
  });

  useEffect(() => {
    if (!workspaceId || !readyKey) {
      setState({ key: readyKey, ready: false });
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    const setNotReady = (): void => {
      setState((current) =>
        current.key === readyKey && current.ready === false
          ? current
          : { key: readyKey, ready: false },
      );
    };

    const scheduleRetry = (fetchInfo: () => void): void => {
      if (cancelled) return;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(fetchInfo, SESSION_INFO_READY_RETRY_MS);
    };

    const fetchInfo = (): void => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (cancelled) return;
          if (!isSessionInfoReady(raw)) {
            setNotReady();
            scheduleRetry(fetchInfo);
            return;
          }
          setState({ key: readyKey, ready: true });
        })
        .catch(() => {
          setNotReady();
          scheduleRetry(fetchInfo);
        });
    };

    setNotReady();
    fetchInfo();

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [workspaceId, readyKey]);

  return readyKey !== null && state.key === readyKey && state.ready;
}

function sessionInfoReadyKey(
  workspaceId: string | null,
  phase: ConnectionPhase | undefined,
): string | null {
  if (!workspaceId || phase?.phase !== 'connected') return null;
  return [
    workspaceId,
    phase.sessionId,
    phase.activeProvider ?? '',
    phase.activeMode ?? '',
  ].join(':');
}
