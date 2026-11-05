import { useEffect } from 'react';
import type { AgentCliNoticeView } from '../chat/useAgentCliNotice';
import { setAgentUpdateCards } from './agent-update-card';

/** Holds the chat's agent CLI notices in the toast corner while that chat is open. */
export function useAgentUpdateToast(views: ReadonlyArray<AgentCliNoticeView>): void {
  useEffect(() => setAgentUpdateCards(views), [views]);
  useEffect(() => () => setAgentUpdateCards([]), []);
}
