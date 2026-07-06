import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { handleSseEvent } from './sse-event-handler.js';
import type { PendingFunctionCall, ResponsesSseEvent } from './stream-types.js';

const run = (ev: ResponsesSseEvent, emitReasoning: boolean) =>
  handleSseEvent(ev, new Map<string, PendingFunctionCall>(), emitReasoning);

describe('handleSseEvent — reasoning summary', () => {
  it('maps reasoning_summary_text.delta to a reasoning_delta when enabled', () => {
    const out = run({ type: 'response.reasoning_summary_text.delta', delta: 'planning…' }, true);
    expect(out.events).toEqual([{ type: 'reasoning_delta', delta: 'planning…' }]);
  });

  it('drops the reasoning summary entirely when the toggle is off', () => {
    const out = run({ type: 'response.reasoning_summary_text.delta', delta: 'planning…' }, false);
    expect(out.events ?? []).toEqual([]);
  });

  it('captures a reasoning item encrypted_content as a reasoning_signature', () => {
    const out = run(
      { type: 'response.output_item.added', item: { type: 'reasoning', encrypted_content: 'blob' } },
      true,
    );
    expect(out.events).toEqual([{ type: 'reasoning_signature', encrypted: 'blob' }]);
  });

  it('still maps text + function-call events regardless of the reasoning toggle', () => {
    expect(run({ type: 'response.output_text.delta', delta: 'hi' }, false).events).toEqual([
      { type: 'text_delta', delta: 'hi' },
    ]);
  });
});

describe('handleSseEvent — hostile-stream bounds', () => {
  it('caps a single tool call argument accumulation across many delta frames', () => {
    const pending = new Map<string, PendingFunctionCall>();
    // Seed a function call.
    handleSseEvent(
      {
        type: 'response.output_item.added',
        item: { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'echo' },
      },
      pending,
      false,
    );
    // A hostile stream sends 2 MiB per delta frame; each frame is individually
    // small enough to pass the consumer's frame buffer but accumulates across
    // frames. The handler must surface a terminal error before unbounded growth.
    const bigDelta = 'a'.repeat(2 * 1024 * 1024);
    let result;
    for (let i = 0; i < 20; i++) {
      result = handleSseEvent(
        { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: bigDelta },
        pending,
        false,
      );
      if (result.terminal) break;
    }
    assertDefined(result, 'loop ran at least once');
    expect(result.terminal).toBe(true);
    expect(result.events?.[0]).toMatchObject({ type: 'error', retryable: false });
    // It bailed well before 20 * 2 MiB = 40 MiB accumulated (cap is 16 MiB).
    const fc1 = pending.get('fc1');
    assertDefined(fc1, 'seeded function call is pending');
    expect(fc1.args.length).toBeLessThanOrEqual(16 * 1024 * 1024);
  });

  it('caps the number of concurrently-pending tool calls', () => {
    const pending = new Map<string, PendingFunctionCall>();
    let result;
    // A hostile stream seeds unbounded distinct function-call ids, never .done-ing
    // any. The Map must not grow without limit.
    for (let i = 0; i < 2000; i++) {
      result = handleSseEvent(
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', id: `fc_${i}`, call_id: `call_${i}`, name: 'echo' },
        },
        pending,
        false,
      );
      if (result.terminal) break;
    }
    assertDefined(result, 'loop ran at least once');
    expect(result.terminal).toBe(true);
    expect(result.events?.[0]).toMatchObject({ type: 'error', retryable: false });
    expect(pending.size).toBeLessThanOrEqual(1024);
  });
});
