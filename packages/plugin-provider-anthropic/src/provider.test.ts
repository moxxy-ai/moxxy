import { describe, expect, it } from 'vitest';
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
});
