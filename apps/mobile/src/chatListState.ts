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

interface LoadOlderScrollInput {
  readonly contentOffsetY: number;
  readonly hasOlder: boolean;
}

const LOAD_OLDER_TOP_THRESHOLD = 24;

export function shouldLoadOlderFromScroll(input: LoadOlderScrollInput): boolean {
  return input.hasOlder && input.contentOffsetY <= LOAD_OLDER_TOP_THRESHOLD;
}
