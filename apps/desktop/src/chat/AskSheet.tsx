import { useRef } from 'react';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import { AskCard } from './ask/AskCard';
import { useAskPrompt } from './ask/ask-prompt';
import { useFocusTrap } from './useFocusTrap';

/**
 * The card above the composer when the runner needs a decision: a tool-call
 * permission gate, a loop-strategy approval (research, BMAD, …) or a workflow
 * reply. The runner blocks on the answer, so this is modal-in-spirit: the
 * person picks an answer and we reply over `ask.respond`, unblocking the turn.
 *
 * Operability is load-bearing here: focus is moved into the card on appear
 * (onto the safe answer), Tab is trapped inside it, Escape gives the safe
 * answer, and focus is restored to the opener on close. What the question
 * says and which answer is safe come from `useAskPrompt`, the same reading the
 * focus window draws.
 */
export function AskSheet({ ask }: { readonly ask: AskRequest }): JSX.Element | null {
  const prompt = useAskPrompt(ask);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement>(null);
  useFocusTrap({ containerRef, initialFocusRef: focusRef, onEscape: prompt ? prompt.escape : undefined });
  if (!prompt) return null;
  return <AskCard ref={containerRef} prompt={prompt} role="dialog" focusRef={focusRef} />;
}
