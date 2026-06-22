import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FlatList } from 'react-native';
import type { TranscriptItem } from '../chatTranscript';

export interface ChatListAutoScrollState {
  readonly contentKey: string;
  readonly contentSizeScrollPending: boolean;
}

export function buildChatListAutoScrollKey(
  items: ReadonlyArray<TranscriptItem>,
  sending: boolean,
): string {
  const last = items[items.length - 1];
  const streamingText = last?.kind === 'assistant' && last.streaming ? last.text : '';
  const toolSummary = last?.kind === 'tool-group' ? last.summary : '';
  return `${last?.id ?? 'empty'}:${streamingText.length}:${toolSummary}:${sending ? 'sending' : 'idle'}`;
}

export function createChatListAutoScrollState(contentKey: string): ChatListAutoScrollState {
  return {
    contentKey,
    contentSizeScrollPending: true,
  };
}

export function reduceChatListAutoScrollState(
  state: ChatListAutoScrollState,
  contentKey: string,
): ChatListAutoScrollState {
  if (state.contentKey === contentKey) return state;
  return {
    contentKey,
    contentSizeScrollPending: true,
  };
}

export function consumeChatListContentSizeScroll(state: ChatListAutoScrollState): {
  readonly shouldScroll: boolean;
  readonly state: ChatListAutoScrollState;
} {
  if (!state.contentSizeScrollPending) {
    return { shouldScroll: false, state };
  }
  return {
    shouldScroll: true,
    state: {
      ...state,
      contentSizeScrollPending: false,
    },
  };
}

export function useChatListAutoScroll(items: ReadonlyArray<TranscriptItem>, sending: boolean) {
  const scrollRef = useRef<FlatList<TranscriptItem> | null>(null);
  const contentKey = useMemo(() => buildChatListAutoScrollKey(items, sending), [items, sending]);
  const autoScrollStateRef = useRef(createChatListAutoScrollState(contentKey));
  autoScrollStateRef.current = reduceChatListAutoScrollState(autoScrollStateRef.current, contentKey);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const handleContentSizeChange = useCallback(() => {
    const next = consumeChatListContentSizeScroll(autoScrollStateRef.current);
    autoScrollStateRef.current = next.state;
    if (next.shouldScroll) scrollToEnd();
  }, [scrollToEnd]);

  useEffect(scrollToEnd, [contentKey, scrollToEnd]);

  return {
    scrollRef,
    scrollToEnd,
    handleContentSizeChange,
  };
}
