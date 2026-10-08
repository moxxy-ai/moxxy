import { useActiveAsk } from '@moxxy/client-core';
import { useAskPrompt, type AskPrompt } from '@/chat/ask/ask-prompt';

export type FocusAskPrompt = AskPrompt;

/** The question the active conversation is blocked on, read the way the desktop reads it. */
export function useFocusAsk(workspaceId: string | null): FocusAskPrompt | null {
  return useAskPrompt(useActiveAsk(workspaceId));
}
