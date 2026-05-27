import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from './provider.js';

function fakeOpenAI(chunks: ReadonlyArray<unknown>): { chat: { completions: { create: () => Promise<AsyncIterable<unknown>> } } } {
  return {
    chat: {
      completions: {
        create: async () =>
          (async function* () {
            for (const c of chunks) yield c;
          })(),
      },
    },
  };
}

describe('OpenAIProvider.stream', () => {
  it('emits message_start, text_delta(s), message_end for a plain text completion', async () => {
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { content: 'Hello, ' } }] },
      { choices: [{ index: 0, delta: { content: 'world!' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'message_start' });
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta).join('');
    expect(text).toBe('Hello, world!');
    expect(events[events.length - 1]).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
  });

  it('translates streamed tool_calls into tool_use_start / _delta / _end', async () => {
    const fake = fakeOpenAI([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'Read', arguments: '' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"/etc/hosts"}' } }] },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    const start = events.find((e) => e.type === 'tool_use_start');
    expect(start).toMatchObject({ id: 'call_1', name: 'Read' });
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(end).toMatchObject({ id: 'call_1', input: { path: '/etc/hosts' } });
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'message_end', stopReason: 'tool_use' });
  });

  it('maps OpenAI finish_reason values to moxxy stop reasons', async () => {
    const cases: Array<[string, string]> = [
      ['stop', 'end_turn'],
      ['length', 'max_tokens'],
      ['tool_calls', 'tool_use'],
      ['content_filter', 'error'],
    ];
    for (const [reason, expected] of cases) {
      const fake = fakeOpenAI([{ choices: [{ delta: {}, finish_reason: reason }] }]);
      const p = new OpenAIProvider({ client: fake as never });
      const events = [];
      for await (const e of p.stream({ model: 'gpt-4o', messages: [] })) events.push(e);
      expect(events[events.length - 1]).toMatchObject({ type: 'message_end', stopReason: expected });
    }
  });

  it('requests usage via stream_options and surfaces token + cache-read counts from the final empty-choices chunk', async () => {
    let captured: Record<string, unknown> | undefined;
    const fake = {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            captured = body;
            return (async function* () {
              yield { choices: [{ index: 0, delta: { content: 'hi' } }] };
              yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
              // OpenAI sends usage in a trailing chunk with NO choices, only
              // when include_usage was requested.
              yield {
                choices: [],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 20,
                  prompt_tokens_details: { cached_tokens: 80 },
                },
              };
            })();
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    expect(captured?.stream_options).toEqual({ include_usage: true });
    expect(events[events.length - 1]).toMatchObject({
      type: 'message_end',
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 },
    });
  });

  it('emits error event when create() throws', async () => {
    const fake = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('rate_limit');
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o', messages: [] })) events.push(e);
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ retryable: true });
  });

  it('countTokens returns a positive estimate', async () => {
    const p = new OpenAIProvider({ client: fakeOpenAI([]) as never });
    const n = await p.countTokens({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
    });
    expect(n).toBeGreaterThan(0);
  });
});
