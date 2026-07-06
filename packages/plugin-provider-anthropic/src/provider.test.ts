import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { AnthropicProvider } from './provider.js';

// A minimal fake Anthropic SDK client to drive the translator without HTTP.
function fakeAnthropic(stream: ReadonlyArray<unknown>): { messages: { stream: () => AsyncIterable<unknown>; countTokens: () => Promise<{ input_tokens: number }> } } {
  return {
    messages: {
      stream: () => {
        return (async function* () {
          for (const e of stream) yield e;
        })();
      },
      countTokens: async () => ({ input_tokens: 42 }),
    },
  };
}

describe('AnthropicProvider.stream', () => {
  it('translates content_block_delta text into text_delta events', async () => {
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    expect(events[0]).toMatchObject({ type: 'message_start' });
    expect(events.find((e) => e.type === 'text_delta')).toMatchObject({ delta: 'hi' });
    expect(events[events.length - 1]).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
  });

  it('translates tool_use blocks with streamed input_json', async () => {
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', content_block: { type: 'tool_use', id: 'c1', name: 'Read' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"file' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '_path":"a"}' } },
      { type: 'content_block_stop' },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    const start = events.find((e) => e.type === 'tool_use_start');
    expect(start).toMatchObject({ id: 'c1', name: 'Read' });
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(end).toMatchObject({ id: 'c1', input: { file_path: 'a' } });
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'message_end', stopReason: 'tool_use' });
  });

  it('routes deltas correctly with two parallel tool_use blocks', async () => {
    // Anthropic emits content_block events with an `index` field that
    // distinguishes parallel blocks. Before the fix, idOfBlock returned
    // the first pending map key for every delta, so block B's deltas
    // would land on block A's partial input.
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'A', name: 'Read' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'B', name: 'Glob' } },
      // Interleave deltas across the two blocks.
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"a"}' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"*.ts"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);

    const ends = events.filter((e) => e.type === 'tool_use_end');
    expect(ends).toHaveLength(2);
    const endA = ends.find((e) => 'id' in e && e.id === 'A');
    const endB = ends.find((e) => 'id' in e && e.id === 'B');
    expect(endA).toMatchObject({ id: 'A', input: { file_path: 'a' } });
    expect(endB).toMatchObject({ id: 'B', input: { pattern: '*.ts' } });
  });

  it('translates a thinking block into reasoning_delta then a concatenated reasoning_signature', async () => {
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'part2' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    const reasoning = events
      .filter((e) => e.type === 'reasoning_delta')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(reasoning).toBe('let me think');
    const sig = events.find((e) => e.type === 'reasoning_signature');
    // Signature deltas accumulate and flush once at content_block_stop.
    expect(sig).toMatchObject({ signature: 'sig-part2' });
    expect(events.filter((e) => e.type === 'reasoning_signature')).toHaveLength(1);
  });

  it('passes through a redacted_thinking block as an encrypted reasoning_signature', async () => {
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'OPAQUE' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    const sig = events.find((e) => e.type === 'reasoning_signature');
    expect(sig).toMatchObject({ redacted: true, encrypted: 'OPAQUE' });
  });

  it('preserves cache_read/creation token counts from message_start through message_end', async () => {
    const fake = fakeAnthropic([
      {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 0,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 20,
          },
        },
      },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
      // The delta usage only carries the final output_tokens; cache fields must survive.
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    expect(events[events.length - 1]).toMatchObject({
      type: 'message_end',
      usage: {
        inputTokens: 100,
        outputTokens: 5,
        cacheReadTokens: 80,
        cacheCreationTokens: 20,
      },
    });
  });

  it('yields exactly one clean aborted error when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'should not arrive' } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [], signal: controller.signal })) {
      events.push(e);
    }
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'aborted', retryable: false });
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('emits error event when stream throws', async () => {
    const fake = {
      messages: {
        stream: () => {
          throw new Error('boom');
        },
        countTokens: async () => ({ input_tokens: 0 }),
      },
    };
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    expect(events.find((e) => e.type === 'error')).toBeDefined();
  });

  it('countTokens proxies to the SDK', async () => {
    const fake = fakeAnthropic([]);
    const p = new AnthropicProvider({ client: fake as never });
    expect(await p.countTokens({ model: 'm', messages: [] })).toBe(42);
  });

  it('surfaces an error (not a junk tool input) when streamed tool JSON is malformed/truncated', async () => {
    // A truncated input_json stream: the accumulated partial never closes.
    const fake = fakeAnthropic([
      { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'c1', name: 'Read' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"a' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ client: fake as never });
    const events = [];
    for await (const e of p.stream({ model: 'm', messages: [] })) events.push(e);
    // The malformed call must NOT reach the loop as a valid tool_use_end with junk.
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false);
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ retryable: false });
    expect((err as { message: string }).message).toContain('c1');
    // The turn is marked as an error rather than a clean tool-use completion.
    expect(events.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'error' });
  });

  it('clamps a caller maxTokens above the model output ceiling and defaults to it', async () => {
    const calls: Array<{ max_tokens?: number }> = [];
    const client = {
      messages: {
        stream: (args: { max_tokens?: number }) => {
          calls.push(args);
          return (async function* () {
            yield { type: 'message_stop' };
          })();
        },
        countTokens: async () => ({ input_tokens: 0 }),
      },
    };
    const p = new AnthropicProvider({ client: client as never });
    // haiku ceiling is 64_000 — an absurd request must be clamped, not forwarded.
    for await (const _ of p.stream({ model: 'claude-haiku-4-5-20251001', maxTokens: 5_000_000, messages: [] })) {
      void _;
    }
    const call0 = calls[0];
    assertDefined(call0, 'first call recorded');
    expect(call0.max_tokens).toBe(64_000);
    // No maxTokens → defaults to the descriptor ceiling.
    for await (const _ of p.stream({ model: 'claude-haiku-4-5-20251001', messages: [] })) void _;
    const call1 = calls[1];
    assertDefined(call1, 'second call recorded');
    expect(call1.max_tokens).toBe(64_000);
  });
});
