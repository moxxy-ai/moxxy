import { describe, expect, it } from 'vitest';
import type { ProviderEvent } from '@moxxy/sdk';
import { consumeResponsesSse } from './stream-consumer.js';

/**
 * Build a ReadableStream<Uint8Array> from a list of string chunks. Each chunk
 * is delivered as its own `read()` so we can exercise frame reassembly across
 * chunk boundaries.
 */
function streamOf(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

/** An SSE `data:` frame for a single event object, separator included. */
const frame = (obj: unknown, sep = '\n\n'): string => `data: ${JSON.stringify(obj)}${sep}`;

async function drain(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const ev of consumeResponsesSse(body, signal)) out.push(ev);
  return out;
}

describe('consumeResponsesSse', () => {
  it('assembles a tool call (added → arguments.delta → arguments.done) and upgrades stopReason to tool_use', async () => {
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'echo' },
        }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"msg":' }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '"hi"}' }),
        frame({
          type: 'response.function_call_arguments.done',
          item_id: 'fc1',
          arguments: '{"msg":"hi"}',
        }),
        frame({ type: 'response.completed', response: {} }),
      ]),
    );

    const start = events.find((e) => e.type === 'tool_use_start');
    expect(start).toMatchObject({ type: 'tool_use_start', id: 'call_1', name: 'echo' });
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(end).toMatchObject({ type: 'tool_use_end', id: 'call_1', input: { msg: 'hi' } });
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'message_end', stopReason: 'tool_use' });
  });

  it('flushes a tool call that never received a .done frame (truncated stream)', async () => {
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'echo' },
        }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"x":1}' }),
        // stream ends with no .done and no response.completed
      ]),
    );
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(end).toMatchObject({ type: 'tool_use_end', id: 'call_1', input: { x: 1 } });
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'message_end', stopReason: 'tool_use' });
  });

  it('surfaces _rawPartial when the flushed args are not valid JSON', async () => {
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'echo' },
        }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"x":' }),
      ]),
    );
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(end).toMatchObject({ type: 'tool_use_end', input: { _rawPartial: '{"x":' } });
  });

  it('reassembles a frame split across two chunk reads', async () => {
    const f = frame({ type: 'response.output_text.delta', delta: 'hello' });
    const cut = Math.floor(f.length / 2);
    const events = await drain(
      streamOf([f.slice(0, cut), f.slice(cut), frame({ type: 'response.completed', response: {} })]),
    );
    const text = events.find((e) => e.type === 'text_delta');
    expect(text).toMatchObject({ type: 'text_delta', delta: 'hello' });
  });

  it('handles CRLF frame separators including a \\r split across reads', async () => {
    // The \r and \n of a CRLF separator land in different read() calls.
    const events = await drain(
      streamOf([
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'crlf' })}\r`,
        `\n\r\n`,
        frame({ type: 'response.completed', response: {} }),
      ]),
    );
    const text = events.find((e) => e.type === 'text_delta');
    expect(text).toMatchObject({ type: 'text_delta', delta: 'crlf' });
  });

  it('emits a single error and no trailing message_end on response.failed', async () => {
    const events = await drain(
      streamOf([
        frame({ type: 'response.failed', error: { message: 'boom' } }),
        // a stray frame after the terminal one must be ignored
        frame({ type: 'response.output_text.delta', delta: 'late' }),
      ]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', message: 'boom' });
    expect(events.some((e) => e.type === 'message_end')).toBe(false);
  });

  it('emits the abort error and stops when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await drain(
      streamOf([frame({ type: 'response.output_text.delta', delta: 'never' })]),
      controller.signal,
    );
    expect(events).toEqual([{ type: 'error', message: 'aborted', retryable: false }]);
  });

  it('accumulates usage from response.completed onto message_end', async () => {
    const events = await drain(
      streamOf([
        frame({ type: 'response.output_text.delta', delta: 'hi' }),
        frame({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 10,
              output_tokens: 3,
              input_tokens_details: { cached_tokens: 4 },
            },
          },
        }),
      ]),
    );
    const last = events.at(-1);
    expect(last).toMatchObject({
      type: 'message_end',
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 4 },
    });
  });
});
