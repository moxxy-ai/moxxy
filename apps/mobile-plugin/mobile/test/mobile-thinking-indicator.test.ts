import { describe, expect, it } from 'vitest';
import { shouldShowThinkingIndicator } from '../src/chatListState';

describe('mobile thinking indicator state', () => {
  it('shows thinking while a turn is active after tool events even if an older stream exists', () => {
    expect(shouldShowThinkingIndicator({
      sending: true,
      items: [
        { id: 'assistant-stream:old', kind: 'assistant', label: 'Assistant', text: 'Old stream', streaming: true },
        { id: 'u2', kind: 'user', text: 'Cześć' },
        {
          id: 'tools:t1',
          kind: 'tool-group',
          title: 'Tools',
          collapsed: true,
          summary: '3 ok',
          tools: [{ id: 't1', name: 'Read', status: 'ok', summary: 'path: a.ts' }],
        },
      ],
    })).toBe(true);
  });

  it('does not render a duplicate thinking bubble while the latest assistant message is streaming', () => {
    expect(shouldShowThinkingIndicator({
      sending: true,
      items: [
        { id: 'u1', kind: 'user', text: 'Cześć' },
        { id: 'assistant-stream:current', kind: 'assistant', label: 'Assistant', text: 'Piszę', streaming: true },
      ],
    })).toBe(false);
  });

  it('hides thinking when no turn is active', () => {
    expect(shouldShowThinkingIndicator({
      sending: false,
      items: [{ id: 'u1', kind: 'user', text: 'Cześć' }],
    })).toBe(false);
  });
});
