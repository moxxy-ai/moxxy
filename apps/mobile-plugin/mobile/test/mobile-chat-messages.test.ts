import { describe, expect, it } from 'vitest';
import { buildChatMessage } from '../src/chatMessages';

describe('mobile chat message model', () => {
  it('normalizes desktop-like user and assistant events', () => {
    expect(buildChatMessage({ type: 'user_prompt', text: 'Build the plugin' })).toEqual({
      kind: 'user',
      label: null,
      text: 'Build the plugin',
    });

    expect(buildChatMessage({ role: 'assistant', content: 'Done.' })).toEqual({
      kind: 'assistant',
      label: 'Assistant',
      text: 'Done.',
    });
  });

  it('keeps runtime events readable instead of dumping raw JSON', () => {
    expect(buildChatMessage({ type: 'tool_call_requested', name: 'Read', path: '/tmp/a.ts' })).toEqual({
      kind: 'tool',
      label: 'Tool call',
      text: 'Read',
    });

    expect(buildChatMessage({ type: 'unknown_event', nested: { noisy: true } })).toEqual({
      kind: 'system',
      label: 'unknown_event',
      text: 'Event received',
    });
  });
});
