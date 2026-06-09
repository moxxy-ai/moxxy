import { describe, expect, it } from 'vitest';
import { buildMessageActions } from '../messageActions';

describe('mobile message actions', () => {
  it('allows copying user and assistant message text', () => {
    expect(buildMessageActions({ id: 'u1', kind: 'user', text: 'Cześć' })).toEqual({
      copyText: 'Cześć',
    });

    expect(buildMessageActions({
      id: 'a1',
      kind: 'assistant',
      label: 'Assistant',
      text: 'Gotowe.',
      streaming: false,
    })).toEqual({
      copyText: 'Gotowe.',
    });
  });

  it('does not expose copy actions for empty or technical transcript blocks', () => {
    expect(buildMessageActions({ id: 'u1', kind: 'user', text: '   ' })).toEqual({});
    expect(buildMessageActions({
      id: 'tools:t1',
      kind: 'tool-group',
      title: 'Tools',
      collapsed: true,
      summary: '1 ok',
      tools: [{ id: 't1', name: 'Read', status: 'ok', summary: 'path: a.ts' }],
    })).toEqual({});
  });
});
