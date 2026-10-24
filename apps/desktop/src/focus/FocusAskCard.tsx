import { AskCard } from '@/chat/ask/AskCard';
import { QuestionCard } from '@/chat/ask/QuestionCard';
import type { FocusAskPrompt } from './useFocusAsk';

/**
 * What the person is waiting on, in the focus window: the desktop's approval
 * or Question card in a smaller frame. Beside the mark it is a toast; in the
 * Mini Chat it heads the panel. It never takes the keyboard, because the
 * window floats over other work.
 */
export function FocusAskCard({
  ask,
  variant,
}: {
  readonly ask: FocusAskPrompt;
  readonly variant: 'toast' | 'panel';
}): JSX.Element | null {
  if (ask.kind === 'approval') return <AskCard prompt={ask.prompt} variant={variant} role="group" />;
  const { question } = ask;
  if (!question.question) return null;
  return (
    <QuestionCard
      key={question.question.questionId}
      variant={variant}
      role="group"
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
