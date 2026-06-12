import { useEffect, useMemo, useRef } from 'react';
import type { ScrollView } from 'react-native';
import type { TranscriptItem } from '../chatTranscript';

export function buildChatListAutoScrollKey(
  items: ReadonlyArray<TranscriptItem>,
  sending: boolean,
): string {
  const last = items[items.length - 1];
  const streamingText = last?.kind === 'assistant' && last.streaming ? last.text : '';
  const toolSummary = last?.kind === 'tool-group' ? last.summary : '';
  return `${last?.id ?? 'empty'}:${streamingText.length}:${toolSummary}:${sending ? 'sending' : 'idle'}`;
}

export function useChatListAutoScroll(items: ReadonlyArray<TranscriptItem>, sending: boolean) {
  const scrollRef = useRef<ScrollView | null>(null);
  const contentKey = useMemo(() => buildChatListAutoScrollKey(items, sending), [items, sending]);

  const scrollToEnd = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  };

  useEffect(scrollToEnd, [contentKey]);

  return {
    scrollRef,
    scrollToEnd,
  };
}
