import { useCallback, useState } from 'react';
import { chatStore, useAgentWork, type UseAgentWork } from '@moxxy/client-core';
import { useCopy } from '../../../lib/useCopy';
import { useProjectWork, type UseProjectWork } from './useProjectWork';
import { commandOf } from './work-command';

/** Whose background work the pane lists: this chat's, or every chat's of the project. */
export type WorkScope = 'chat' | 'project';

export interface UseAgentsPane {
  readonly work: UseAgentWork;
  readonly scope: WorkScope;
  readonly setScope: (scope: WorkScope) => void;
  /** Read only while the scope is the project. */
  readonly project: UseProjectWork;
  /** The command a work of a chat ran, when its start is in that chat's loaded log. */
  readonly commandOf: (workspaceId: string, label: string) => string | null;
  readonly copy: (text: string) => Promise<void>;
}

/** Everything the Agents pane shows and does, so the pane itself only draws. */
export function useAgentsPane(workspaceId: string | null): UseAgentsPane {
  const work = useAgentWork(workspaceId);
  const [scope, setScope] = useState<WorkScope>('chat');
  const project = useProjectWork(workspaceId, scope === 'project');
  const { copy } = useCopy();
  const command = useCallback((chat: string, label: string) => commandOf(chatStore.getChat(chat).events, label), []);
  return { work, scope, setScope, project, commandOf: command, copy };
}
