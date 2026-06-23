import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
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

/** Distance from the bottom (px) under which we treat the user as "at the
 *  bottom" and keep auto-following new content. */
const AT_BOTTOM_THRESHOLD = 96;

export function useChatListAutoScroll(items: ReadonlyArray<TranscriptItem>, sending: boolean) {
  const scrollRef = useRef<FlatList<TranscriptItem> | null>(null);
  const atBottomRef = useRef(true);
  const contentHeightRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const contentKey = useMemo(() => buildChatListAutoScrollKey(items, sending), [items, sending]);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated });
      // Belt-and-braces: jump past the measured content bottom so virtualization
      // can't leave us short of the last row (clamped to the real max).
      if (contentHeightRef.current > 0) {
        scrollRef.current?.scrollToOffset({ animated, offset: contentHeightRef.current + 600 });
      }
    });
  }, []);

  // Follow new/streamed content only while the user is parked at the bottom —
  // never yank the view down while they're reading older messages.
  useEffect(() => {
    if (atBottomRef.current) scrollToEnd();
  }, [contentKey, scrollToEnd]);

  // Land at the latest message when the chat first opens.
  useEffect(() => {
    const timer = setTimeout(() => scrollToEnd(false), 60);
    return () => clearTimeout(timer);
  }, [scrollToEnd]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
    if (atBottomRef.current) scrollToEnd();
  }, [scrollToEnd]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    // Keep the measured content height current so scrollToBottom always has a
    // real anchor to jump to (clamped to the true max offset).
    contentHeightRef.current = contentSize.height;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    atBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollToEnd();
  }, [scrollToEnd]);

  return {
    scrollRef,
    scrollToEnd,
    scrollToBottom,
    handleContentSizeChange,
    handleScroll,
    showScrollToBottom,
  };
}
