import { useActiveAsk, useQuestion, type UseQuestion } from '@moxxy/client-core';
import { useAskPrompt, type AskPrompt } from '@/chat/ask/ask-prompt';

/** What the active conversation is stopped on: an approval, or a Question the agent asked. */
export type FocusAskPrompt =
  | { readonly kind: 'approval'; readonly prompt: AskPrompt }
  | { readonly kind: 'question'; readonly question: UseQuestion };

/**
 * Read the way the desktop reads it, in the same order: an approval first,
 * then a Question, so both windows show the same card.
 */
export function useFocusAsk(workspaceId: string | null): FocusAskPrompt | null {
  const prompt = useAskPrompt(useActiveAsk(workspaceId));
  const question = useQuestion(workspaceId);
  if (prompt) return { kind: 'approval', prompt };
  if (question.question) return { kind: 'question', question };
  return null;
}
