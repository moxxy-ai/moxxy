import { useCallback } from 'react';
import { buildNewSessionFrame, buildSelectWorkspaceFrame } from '../clientFrames';
import type { MobileState } from '../protocol';

export function useSessions(
  state: MobileState,
  sendFrame: (frame: Record<string, unknown>) => void,
  options: {
    readonly renameSession?: (sessionId: string, name: string) => Promise<void> | void;
  } = {},
) {
  const renameSessionImpl = options.renameSession;
  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      sendFrame(buildSelectWorkspaceFrame(workspaceId));
    },
    [sendFrame],
  );

  const newSession = useCallback((workspaceId?: string) => {
    sendFrame(buildNewSessionFrame({ workspaceId: workspaceId ?? state.activeWorkspaceId }));
  }, [sendFrame, state.activeWorkspaceId]);

  const renameSession = useCallback(
    async (sessionId: string, name: string) => {
      await renameSessionImpl?.(sessionId, name);
    },
    [renameSessionImpl],
  );

  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces,
    sessions: state.sessions,
    selectWorkspace,
    newSession,
    renameSession,
  };
}
