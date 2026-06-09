import type { TranscriptItem } from './chatTranscript';

interface ThinkingIndicatorInput {
  readonly items: ReadonlyArray<TranscriptItem>;
  readonly sending: boolean;
}

export function shouldShowThinkingIndicator(input: ThinkingIndicatorInput): boolean {
  if (!input.sending) return false;
  const lastItem = input.items[input.items.length - 1];
  return !(lastItem?.kind === 'assistant' && lastItem.streaming);
}
