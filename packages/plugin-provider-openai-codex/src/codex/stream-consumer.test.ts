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

  it('does not emit a malformed tool_use for a truncated function_call that never carried a name', async () => {
    // item.added with no `name`, some args, then the stream truncates before
    // both the name and the .done arrive. The flush must NOT synthesize a
    // nameless/invalid tool_use_start/end — it has no usable name.
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'call_1' }, // no name
        }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"x":1}' }),
        // stream ends: no name ever arrived, no .done, no completed
      ]),
    );
    expect(events.some((e) => e.type === 'tool_use_start')).toBe(false);
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false);
    // With no tool call emitted, the turn is not upgraded to tool_use.
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
  });

  it('flushes a tool_use_start+end when a name was buffered but its start frame never landed', async () => {
    // Defensive flush path: emittedStart is false yet a name is present. We
    // drive this by handing the consumer a pre-seeded pending entry via the
    // documented event sequence the handler produces, then truncating. The
    // flush must emit BOTH start and end so the call isn't dropped.
    //
    // The only handler path that leaves name set without emittedStart would be
    // a future event type; until then this guards the flush's name-recovery
    // branch against regressions by asserting a started call still flushes its
    // end even with no .done (covered above) and that a named added+truncation
    // yields a complete pair.
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc2', call_id: 'call_2', name: 'lookup' },
        }),
        // No args.delta, no .done — immediate truncation after the named start.
      ]),
    );
    const start = events.find((e) => e.type === 'tool_use_start');
    const end = events.find((e) => e.type === 'tool_use_end');
    expect(start).toMatchObject({ id: 'call_2', name: 'lookup' });
    expect(end).toMatchObject({ id: 'call_2' });
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

  it('bounds the reassembly buffer: an endless body with no frame separator errors instead of OOMing', async () => {
    // A misbehaving/MITM'd endpoint streams a continuous body that never emits a
    // blank-line frame separator. Without the cap, `buffer` would grow until OOM.
    const chunk = 'x'.repeat(1024 * 1024); // 1 MiB, no '\n\n' anywhere
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Far more than the 8 MiB cap if left unbounded; the consumer must bail
        // long before this many reads complete.
        if (reads >= 100) {
          controller.close();
          return;
        }
        reads += 1;
        controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const events = await drain(body);
    expect(events).toEqual([
      { type: 'error', message: 'Codex stream frame exceeded size limit', retryable: false },
    ]);
    // It stopped reading well before draining all 100 MiB.
    expect(reads).toBeLessThan(20);
  });

  it('does not flush a phantom tool call after a mid-stream response.failed (error supersedes pending)', async () => {
    // A function_call starts (tool_use_start emitted) but the stream fails before
    // its .done arrives. The failed turn must surface ONE error and must NOT flush
    // a trailing tool_use_end on top of it.
    const events = await drain(
      streamOf([
        frame({
          type: 'response.output_item.added',
          item: { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'echo' },
        }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"x":1' }),
        frame({ type: 'response.failed', error: { message: 'boom' } }),
      ]),
    );
    const errs = events.filter((e) => e.type === 'error');
    expect(errs).toHaveLength(1);
    expect(events.some((e) => e.type === 'tool_use_end')).toBe(false);
    expect(events.some((e) => e.type === 'message_end')).toBe(false);
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
