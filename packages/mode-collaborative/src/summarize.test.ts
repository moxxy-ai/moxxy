import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '@moxxy/sdk';
import { summarizeConversation } from './summarize.js';

const events = [
  { type: 'user_prompt', text: 'build a docs site' },
  { type: 'assistant_message', source: 'model', content: 'markdown ok?' },
  { type: 'user_prompt', text: 'yes, three pages' },
];

/** A fake provider whose stream yields the given events. */
function fakeProvider(stream: (req: unknown) => AsyncIterable<{ type: string; delta?: string }>): LLMProvider {
  return { name: 'fake', models: [{ id: 'm', name: 'm' }], stream } as unknown as LLMProvider;
}

describe('summarizeConversation', () => {
  it('returns null (heuristic fallback) when no provider or model is given', async () => {
    expect(await summarizeConversation({ task: 't', events })).toBeNull();
    expect(await summarizeConversation({ task: 't', events, provider: fakeProvider(async function* () {}) })).toBeNull();
  });

  it('accumulates text_delta events into the summary', async () => {
    const provider = fakeProvider(async function* () {
      yield { type: 'text_delta', delta: '- goal: docs site\n' };
      yield { type: 'text_delta', delta: '- 3 pages' };
    });
    const out = await summarizeConversation({ task: 't', events, provider, model: 'm' });
    expect(out).toBe('- goal: docs site\n- 3 pages');
  });

  it('returns null on a provider error event', async () => {
    const provider = fakeProvider(async function* () {
      yield { type: 'text_delta', delta: 'partial' };
      yield { type: 'error' };
    });
    expect(await summarizeConversation({ task: 't', events, provider, model: 'm' })).toBeNull();
  });

  it('returns null when the model produces no text', async () => {
    const provider = fakeProvider(async function* () {
      yield { type: 'text_delta', delta: '   ' };
    });
    expect(await summarizeConversation({ task: 't', events, provider, model: 'm' })).toBeNull();
  });

  it('returns null (never throws) when the provider throws', async () => {
    const provider = fakeProvider(async function* () {
      throw new Error('boom');
    });
    expect(await summarizeConversation({ task: 't', events, provider, model: 'm' })).toBeNull();
  });
});
