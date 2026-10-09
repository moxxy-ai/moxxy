import { AskCard } from '@/chat/ask/AskCard';
import type { AskPrompt } from '@/chat/ask/ask-prompt';

/**
 * A blocking question in the focus window: the desktop's card in a smaller
 * frame. Beside the mark it is a toast; in the Mini Chat it heads the panel.
 * It never takes the keyboard, because the window floats over other work.
 */
export function FocusAskCard({
  prompt,
  variant,
}: {
  readonly prompt: AskPrompt;
  readonly variant: 'toast' | 'panel';
}): JSX.Element {
  return <AskCard prompt={prompt} variant={variant} role="group" />;
}
