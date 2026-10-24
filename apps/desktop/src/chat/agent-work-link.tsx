import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { focusAgentWork } from '@moxxy/client-core';

const WorkspaceOfChat = createContext<string | null>(null);

/** Gives the chat's rows the conversation they belong to, so a row can open its work in the Agents pane. */
export function AgentWorkLinkProvider({ workspaceId, children }: { readonly workspaceId: string | null; readonly children: ReactNode }): JSX.Element {
  return <WorkspaceOfChat.Provider value={workspaceId}>{children}</WorkspaceOfChat.Provider>;
}

/** Open one work of this chat in the Agents pane; null outside a chat that has one. */
export function useOpenAgentWork(): ((workId: string) => void) | null {
  const workspaceId = useContext(WorkspaceOfChat);
  const open = useCallback((workId: string) => {
    if (workspaceId) focusAgentWork(workspaceId, workId);
  }, [workspaceId]);
  return workspaceId ? open : null;
}
