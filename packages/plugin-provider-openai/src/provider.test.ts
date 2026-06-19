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

  it('surfaces an error (not a silent drop) when a backend streams tool arguments with no function name', async () => {
    // Non-conforming OpenAI-compatible backend: argument deltas for an index
    // but function.name is never sent. The call must not be swallowed.
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"/x"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false);
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ retryable: false });
    expect((err as { message: string }).message).toMatch(/no function name/i);
    expect(events[events.length - 1]).toMatchObject({ type: 'message_end', stopReason: 'error' });
  });

  it('surfaces an error (not a malformed _rawPartial input) when tool arguments are truncated/invalid JSON', async () => {
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'Read', arguments: '{"path":' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    // No tool_use_end carrying a salvaged junk object.
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false);
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ retryable: false });
    expect((err as { message: string }).message).toMatch(/malformed|truncated/i);
    expect(events[events.length - 1]).toMatchObject({ type: 'message_end', stopReason: 'error' });
  });

  it('recovers a named tool call whose start was never emitted (name only, no args delta)', async () => {
    // An entry created with a name but where the start somehow was not flushed
    // mid-stream is still surfaced at flush time rather than dropped.
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'Glob', arguments: '{"pattern":"*.ts"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    expect(events.find((e) => e.type === 'tool_use_start')).toMatchObject({ id: 'call_9', name: 'Glob' });
    expect(events.find((e) => e.type === 'tool_use_end')).toMatchObject({ id: 'call_9', input: { pattern: '*.ts' } });
  });

  it('does not mutate a tool-call id after tool_use_start (a re-echoed id must not orphan the start)', async () => {
    // A non-conforming backend re-sends a DIFFERENT id on a later delta for the
    // same index. Once tool_use_start fired with the first id, that id is the
    // dispatcher's correlation key — _delta/_end must keep using it, not the
    // late one, or the tool result is dropped silently.
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_A', function: { name: 'Read', arguments: '{"p":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_B', function: { arguments: '1}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o-mini', messages: [] })) events.push(e);
    const start = events.find((e) => e.type === 'tool_use_start') as { id: string };
    const end = events.find((e) => e.type === 'tool_use_end') as { id: string; input: unknown };
    const deltas = events.filter((e) => e.type === 'tool_use_delta') as Array<{ id: string }>;
    expect(start.id).toBe('call_A');
    expect(end.id).toBe('call_A');
    // Every delta correlates to the started id, not the re-echoed one.
    for (const d of deltas) expect(d.id).toBe('call_A');
    expect(end.input).toEqual({ p: 1 });
  });

  it('maps OpenAI finish_reason values to moxxy stop reasons', async () => {
    const cases: Array<[string, string]> = [
      ['stop', 'end_turn'],
      ['length', 'max_tokens'],
      ['tool_calls', 'tool_use'],
      ['function_call', 'tool_use'],
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

  it('emits reasoning_delta from delta.reasoning_content when req.reasoning is set', async () => {
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { reasoning_content: 'thinking… ' } }] },
      { choices: [{ index: 0, delta: { reasoning_content: 'done' } }] },
      { choices: [{ index: 0, delta: { content: 'answer' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({
      model: 'gpt-5.4-mini',
      messages: [],
      reasoning: { effort: 'low' },
    })) {
      events.push(e);
    }
    const reasoning = events
      .filter((e) => e.type === 'reasoning_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(reasoning).toBe('thinking… done');
  });

  it('handles the alternate delta.reasoning field name', async () => {
    const fake = fakeOpenAI([
      { choices: [{ index: 0, delta: { reasoning: 'alt-field' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]);
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-5.4-mini', messages: [], reasoning: true })) {
      events.push(e);
    }
    const reasoning = events.find((e) => e.type === 'reasoning_delta');
    expect(reasoning).toMatchObject({ delta: 'alt-field' });
  });

  it('ignores reasoning deltas when req.reasoning is absent or false', async () => {
    for (const reasoning of [undefined, false]) {
      const fake = fakeOpenAI([
        { choices: [{ index: 0, delta: { reasoning_content: 'should be dropped' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
      const p = new OpenAIProvider({ client: fake as never });
      const events = [];
      for await (const e of p.stream({ model: 'gpt-5.4-mini', messages: [], reasoning })) {
        events.push(e);
      }
      expect(events.some((e) => e.type === 'reasoning_delta')).toBe(false);
    }
  });

  it('requests reasoning_effort for reasoning models when reasoning is enabled', async () => {
    let captured: Record<string, unknown> | undefined;
    const fake = {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            captured = body;
            return (async function* () {
              yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            })();
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({
      model: 'gpt-5.4-mini',
      messages: [],
      reasoning: { effort: 'high' },
    })) {
      events.push(e);
    }
    expect(captured?.reasoning_effort).toBe('high');
  });

  it('requests reasoning_effort for OpenAI-compatible reasoning backends (non-gpt-5 ids)', async () => {
    // z.ai GLM / DeepSeek-R1 / vLLM / Ollama reasoning model ids never match
    // the gpt-5/o1/o3 token-field heuristic, but they honor reasoning_effort —
    // effort must be sent independently of that heuristic.
    let captured: Record<string, unknown> | undefined;
    const fake = {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            captured = body;
            return (async function* () {
              yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            })();
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    for await (const _ of p.stream({
      model: 'glm-4.6',
      messages: [],
      reasoning: { effort: 'high' },
    })) {
      // drain
    }
    expect(captured?.reasoning_effort).toBe('high');
    // The token-field heuristic is unchanged: a non-gpt-5 id keeps `max_tokens`.
    expect(captured && 'max_completion_tokens' in captured).toBe(false);
  });

  it('emits a clean aborted error (not a classified error) when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const fake = {
      chat: {
        completions: {
          create: async () =>
            (async function* () {
              yield { choices: [{ index: 0, delta: { content: 'partial' } }] };
              // The host cancels; the SDK rejects the iterator with an AbortError.
              controller.abort();
              throw Object.assign(new Error('Request was aborted'), { name: 'AbortError' });
            })(),
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o', messages: [], signal: controller.signal })) {
      events.push(e);
    }
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ message: 'aborted', retryable: false });
  });

  it('emits a clean aborted error when create() rejects after the signal fired', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = {
      chat: {
        completions: {
          create: async () => {
            throw Object.assign(new Error('Request was aborted'), { name: 'AbortError' });
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'gpt-4o', messages: [], signal: controller.signal })) {
      events.push(e);
    }
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ message: 'aborted', retryable: false });
  });

  it('countTokens returns a positive estimate', async () => {
    const p = new OpenAIProvider({ client: fakeOpenAI([]) as never });
    const n = await p.countTokens({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello world' }] }],
    });
    expect(n).toBeGreaterThan(0);
  });

  it('countTokens does not stringify or over-count multi-MB base64 image/document blocks', async () => {
    const p = new OpenAIProvider({ client: fakeOpenAI([]) as never });
    // ~3MB base64 blob — JSON.stringify-ing this and counting its length would
    // produce ~750k tokens. With the fixed per-block charge it stays bounded.
    const bigData = 'A'.repeat(3_000_000);
    const n = await p.countTokens({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image', mediaType: 'image/png', data: bigData },
            { type: 'document', mediaType: 'application/pdf', data: bigData },
          ],
        },
      ],
    });
    // Must reflect the text + a small constant per rich block, NOT the blob size.
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10_000);
  });

  it('configures an explicit timeout on the default client (no SDK 10-minute default)', () => {
    // No injected client → real OpenAI ctor; assert the timeout is bounded.
    const p = new OpenAIProvider({ apiKey: 'sk-test', timeoutMs: 5_000 });
    const client = (p as unknown as { client: { timeout?: number } }).client;
    expect(client.timeout).toBe(5_000);
    const dflt = new OpenAIProvider({ apiKey: 'sk-test' });
    const dfltClient = (dflt as unknown as { client: { timeout?: number } }).client;
    expect(dfltClient.timeout).toBeLessThan(600_000);
  });

  it('delivers hook-injected req.system as a system message after the leading system prompt', async () => {
    let captured: { messages?: Array<{ role: string; content?: unknown }> } | undefined;
    const fake = {
      chat: {
        completions: {
          create: async (body: never) => {
            captured = body;
            return (async function* () {
              yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            })();
          },
        },
      },
    };
    const p = new OpenAIProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({
      model: 'gpt-4o',
      system: '[memory note] consider consolidating',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'BASE PROMPT' }] },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      ],
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(captured?.messages?.map((m) => m.role)).toEqual(['system', 'system', 'user']);
    expect(captured?.messages?.[0]).toMatchObject({ content: 'BASE PROMPT' });
    expect(captured?.messages?.[1]).toMatchObject({ content: '[memory note] consider consolidating' });
  });

  it('reports an overridden name + model catalog for runtime-registered vendors', () => {
    const models = [
      { id: 'glm-4.6', contextWindow: 200_000, supportsTools: true, supportsStreaming: true, supportsDocuments: true },
    ];
    const p = new OpenAIProvider({ client: fakeOpenAI([]) as never, name: 'zai', models });
    expect(p.name).toBe('zai');
    expect(p.models).toEqual(models);
    // Defaults stay 'openai' + the OpenAI catalog.
    const plain = new OpenAIProvider({ client: fakeOpenAI([]) as never });
    expect(plain.name).toBe('openai');
    expect(plain.models.length).toBeGreaterThan(0);
  });
});
