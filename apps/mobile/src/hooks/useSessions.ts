import { useCallback } from 'react';
import { api, chatStore, connectionStore, toErrorMessage } from '@moxxy/client-core';
import { buildNewSessionFrame, invokeFrame } from '../clientFrames';
import type { MobileState } from '../protocol';

export function useSessions(
  state: MobileState,
  deps: {
    readonly onError: (message: string) => void;
    readonly refreshInfo: () => void;
  },
) {
  // The mobile host serves exactly one workspace, so selection is local
  // bookkeeping (active stores) rather than a host command.
  const selectWorkspace = useCallback((workspaceId: string) => {
    chatStore.setActive(workspaceId);
    connectionStore.setActive(workspaceId);
  }, []);

  const { onError, refreshInfo } = deps;
  const activeWorkspaceId = state.activeWorkspaceId;
  const newSession = useCallback(
    (workspaceId?: string) => {
      const target = workspaceId ?? activeWorkspaceId;
      void (async () => {
        try {
          // Host-side reset first (authoritative — aborts turns, clears the
          // runner log), then the local transcript, so a failure never leaves
          // the UI pretending the history is gone.
          await invokeFrame(api(), buildNewSessionFrame({ workspaceId: target }));
          if (target) chatStore.clear(target);
          refreshInfo();
        } catch (e) {
          onError(toErrorMessage(e));
        }
      })();
    },
    [activeWorkspaceId, onError, refreshInfo],
  );

  return {
    activeWorkspaceId,
    workspaces: state.workspaces,
    sessions: state.sessions,
    selectWorkspace,
    newSession,
  };
}
