import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api, chatStore } from '@moxxy/client-core';
import { DEFAULT_MODE } from '@/chat/modes/mode-meta';

export interface FocusSessionState {
  /** The session's active mode, or null while it is not known. */
  readonly mode: string | null;
  readonly autoApprove: boolean;
  /** Go back to the default mode; absent when the session has no such mode. */
  readonly leaveMode?: () => void;
}

interface SessionTurnInfo {
  readonly mode: string | null;
  readonly autoApprove: boolean | undefined;
  readonly canLeave: boolean;
}

const UNKNOWN: SessionTurnInfo = { mode: null, autoApprove: undefined, canLeave: false };

/**
 * What the next turn will do, read from the session itself so the focus
 * window says the same as the desktop composer: a switch made there, in the
 * TUI or by a channel bot arrives here as the session's own push.
 */
export function useFocusSessionState(workspaceId: string | null): FocusSessionState {
  const [info, setInfo] = useState<SessionTurnInfo>(UNKNOWN);
  // A runner without the shared switch reports no auto-approve; the host's
  // push, mirrored into the chat store, is the state there.
  const pushedAutoApprove = useSyncExternalStore(chatStore.subscribe, () =>
    workspaceId ? chatStore.getAutoApprove(workspaceId) : false,
  );

  useEffect(() => {
    setInfo(UNKNOWN);
    if (!workspaceId) return undefined;
    let cancelled = false;
    const read = (): void => {
      void api()
        .invoke('session.info', { workspaceId })
        .then((raw) => {
          if (cancelled || !raw) return;
          setInfo({
            mode: raw.activeMode ?? null,
            autoApprove: raw.autoApprove,
            canLeave: (raw.modes ?? []).includes(DEFAULT_MODE),
          });
        })
        .catch(() => undefined);
    };
    const onPush = (payload: { workspaceId: string }): void => {
      if (payload.workspaceId === workspaceId) read();
    };
    read();
    const offInfo = api().subscribe('session.info.changed', onPush);
    const offAutoApprove = api().subscribe('session.autoApprove.changed', onPush);
    return () => {
      cancelled = true;
      offInfo();
      offAutoApprove();
    };
  }, [workspaceId]);

  const leave = useCallback((): void => {
    if (!workspaceId) return;
    setInfo((current) => ({ ...current, mode: DEFAULT_MODE }));
    void api()
      .invoke('session.setMode', { workspaceId, mode: DEFAULT_MODE })
      .catch(() => undefined);
  }, [workspaceId]);

  return {
    mode: info.mode,
    autoApprove: info.autoApprove ?? pushedAutoApprove,
    leaveMode: info.canLeave ? leave : undefined,
  };
}
