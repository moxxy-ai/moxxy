import { describe, expect, it } from 'vitest';
import {
  buildMobileChatListPerformanceProps,
  createMobileMarkdownBlockCache,
  shouldUpdateMobileMessageBlock,
} from '../mobile/src/chatListPerformance';
import type { AssistantTranscriptItem, TranscriptItem } from '../mobile/src/chatTranscript';

describe('mobile chat list performance model', () => {
  it('uses production list settings tuned for long streamed histories', () => {
    expect(buildMobileChatListPerformanceProps()).toEqual({
      initialNumToRender: 10,
      maxToRenderPerBatch: 6,
      updateCellsBatchingPeriod: 80,
      windowSize: 7,
      removeClippedSubviews: true,
      scrollEventThrottle: 16,
    });
  });

  it('keeps settled rows memoized when unrelated copy state changes', () => {
    const settled: AssistantTranscriptItem = {
      id: 'assistant-1',
      kind: 'assistant',
      label: 'Assistant',
      streaming: false,
      text: 'Stable **markdown** response.',
    };

    expect(shouldUpdateMobileMessageBlock(
      { item: settled, copied: false, onCopyMessage: undefined },
      { item: settled, copied: false, onCopyMessage: undefined },
    )).toBe(false);

    expect(shouldUpdateMobileMessageBlock(
      { item: settled, copied: false, onCopyMessage: undefined },
      { item: settled, copied: true, onCopyMessage: undefined },
    )).toBe(true);
  });

  it('keeps old rows stable while a new streaming row changes', () => {
    const oldRow: TranscriptItem = { id: 'old', kind: 'user', text: 'Already rendered' };
    const streamingBefore: AssistantTranscriptItem = {
      id: 'assistant-stream:external',
      kind: 'assistant',
      label: 'Assistant',
      streaming: true,
      text: 'Hel',
    };
    const streamingAfter: AssistantTranscriptItem = {
      ...streamingBefore,
      text: 'Hello',
    };

    expect(shouldUpdateMobileMessageBlock(
      { item: oldRow, copied: false, onCopyMessage: undefined },
      { item: oldRow, copied: false, onCopyMessage: undefined },
    )).toBe(false);

    expect(shouldUpdateMobileMessageBlock(
      { item: streamingBefore, copied: false, onCopyMessage: undefined },
      { item: streamingAfter, copied: false, onCopyMessage: undefined },
    )).toBe(true);
  });

  it('caches markdown parsing by exact text while bounding memory', () => {
    let parses = 0;
    const cache = createMobileMarkdownBlockCache({
      maxEntries: 2,
      parse: (text) => {
        parses += 1;
        return [{ kind: 'heading', level: 2, text }];
      },
    });

    const first = cache.get('first');
    expect(cache.get('first')).toBe(first);
    expect(parses).toBe(1);

    cache.get('second');
    cache.get('third');

    expect(cache.get('first')).not.toBe(first);
    expect(parses).toBe(4);
  });
});
