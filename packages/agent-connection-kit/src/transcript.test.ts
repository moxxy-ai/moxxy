import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from '@moxxy/sdk';
import { transcript } from './transcript.js';

const user = (text: string): ProviderMessage => ({ role: 'user', content: [{ type: 'text', text }] });

describe('a one-off request as one prompt', () => {
  it('passes a single message as it is', () => {
    expect(transcript([user('Summarize this.')])).toBe('Summarize this.');
  });

  it('labels several messages as a transcript, tool results included', () => {
    const messages: ProviderMessage[] = [
      user('List the files.'),
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'a.ts\nb.ts' }] },
    ];
    expect(transcript(messages)).toBe('User: List the files.\n\nAssistant: Looking.\n\nUser: a.ts\nb.ts');
  });
});
