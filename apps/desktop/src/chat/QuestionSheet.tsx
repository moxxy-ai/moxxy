import { useRef } from 'react';
import type { UseQuestion } from '@moxxy/client-core';
import { QuestionCard } from './ask/QuestionCard';
import { useFocusTrap } from './useFocusTrap';

/**
 * The card above the composer when the agent asks the person a Question. The
 * turn waits on the answer, so the card takes the keyboard (onto the first
 * suggested answer) and keeps Tab inside it, like the approval card; unlike
 * it, Escape answers nothing, since a Question has no safe answer.
 */
export function QuestionSheet({ question }: { readonly question: UseQuestion }): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);
  useFocusTrap({ containerRef, initialFocusRef: focusRef });
  if (!question.question) return null;
  return (
    <QuestionCard
      ref={containerRef}
      focusRef={focusRef}
      question={question.question}
      draft={question.draft}
      problem={question.problem}
      sending={question.sending}
      error={question.error}
      onChoose={question.choose}
      onType={question.type}
      onSubmit={() => void question.submit()}
    />
  );
}
