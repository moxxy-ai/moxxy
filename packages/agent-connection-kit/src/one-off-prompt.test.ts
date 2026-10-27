import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from '@moxxy/sdk';
import { oneOffPrompt } from './one-off-prompt.js';

const user = (text: string): ProviderMessage => ({ role: 'user', content: [{ type: 'text', text }] });
const system = (text: string): ProviderMessage => ({ role: 'system', content: [{ type: 'text', text }] });

describe('a one-off request as one prompt', () => {
  it('passes a single message as it is', () => {
    expect(oneOffPrompt({ messages: [user('Summarize this.')] })).toEqual({ prompt: 'Summarize this.' });
  });

  it('labels several messages as a transcript, tool results included', () => {
    const messages: ProviderMessage[] = [
      user('List the files.'),
      { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'a.ts\nb.ts' }] },
    ];
    expect(oneOffPrompt({ messages }).prompt).toBe('User: List the files.\n\nAssistant: Looking.\n\nUser: a.ts\nb.ts');
  });

  it('keeps instructions out of what the person said: system messages become the instructions', () => {
    expect(oneOffPrompt({ messages: [system('Plan search queries.'), user('Find the release date.')] })).toEqual({
      system: 'Plan search queries.',
      prompt: 'Find the release date.',
    });
  });

  it('delivers the side-channel system text after the instructions from the messages', () => {
    expect(oneOffPrompt({ system: 'Be brief.', messages: [system('Plan search queries.'), user('Find it.')] }).system).toBe(
      'Plan search queries.\n\nBe brief.',
    );
  });
});
