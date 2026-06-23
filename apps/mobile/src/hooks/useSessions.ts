import { useCallback } from 'react';
import { buildNewSessionFrame, buildSelectWorkspaceFrame } from '../clientFrames';
import type { MobileState } from '../protocol';

export function useSessions(
  state: MobileState,
  sendFrame: (frame: Record<string, unknown>) => void,
  options: {
    readonly renameSession?: (sessionId: string, name: string) => Promise<void> | void;
    readonly removeSession?: (sessionId: string) => Promise<void> | void;
    readonly renameWorkspace?: (workspaceId: string, name: string) => Promise<void> | void;
    readonly removeWorkspace?: (workspaceId: string) => Promise<void> | void;
  } = {},
) {
  const renameSessionImpl = options.renameSession;
  const removeSessionImpl = options.removeSession;
  const renameWorkspaceImpl = options.renameWorkspace;
  const removeWorkspaceImpl = options.removeWorkspace;
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

  const removeSession = useCallback(
    async (sessionId: string) => {
      await removeSessionImpl?.(sessionId);
    },
    [removeSessionImpl],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      await renameWorkspaceImpl?.(workspaceId, name);
    },
    [renameWorkspaceImpl],
  );

  const removeWorkspace = useCallback(
    async (workspaceId: string) => {
      await removeWorkspaceImpl?.(workspaceId);
    },
    [removeWorkspaceImpl],
  );

  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces,
    sessions: state.sessions,
    selectWorkspace,
    newSession,
    renameSession,
    removeSession,
    renameWorkspace,
    removeWorkspace,
  };
}
