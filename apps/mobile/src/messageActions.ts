import type { TranscriptItem } from './chatTranscript';

export interface MessageActions {
  readonly copyText?: string;
}

export function buildMessageActions(item: TranscriptItem): MessageActions {
  if ((item.kind === 'user' || item.kind === 'assistant') && item.text.trim().length > 0) {
    return { copyText: item.text };
  }
  return {};
}
