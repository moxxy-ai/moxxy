import { describe, expect, it } from 'vitest';
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
