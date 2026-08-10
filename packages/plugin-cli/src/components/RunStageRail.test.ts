import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { deriveRunStage } from './RunStageRail.js';

const event = (type: MoxxyEvent['type'], extra: Record<string, unknown> = {}): MoxxyEvent =>
  ({
    type,
    id: `${type}-${String(extra.seq ?? 1)}`,
    seq: Number(extra.seq ?? 1),
    ts: 0,
    sessionId: 'session',
    turnId: 'turn',
    source: 'system',
    ...extra,
  }) as unknown as MoxxyEvent;

describe('deriveRunStage', () => {
  it('starts in Understand and keeps safe workspace reads there', () => {
    const events = [
      event('user_prompt', { text: 'find the cause', source: 'user' }),
      event('tool_call_requested', { callId: 'read-1', name: 'Read', input: {} }),
      event('tool_result', { callId: 'read-1', ok: true }),
    ];
    expect(deriveRunStage([], false, false)).toBe('understand');
    expect(deriveRunStage(events, true, false)).toBe('understand');
  });

  it('moves to Act for a pending decision or consequential tool', () => {
    const events = [
      event('user_prompt', { text: 'fix it', source: 'user' }),
      event('tool_call_requested', { callId: 'edit-1', name: 'Edit', input: {} }),
    ];
    expect(deriveRunStage(events, true, false)).toBe('act');
    expect(deriveRunStage([], false, true)).toBe('act');
  });

  it('moves to Verify after the action resolves or a read-only answer completes', () => {
    const actionEvents = [
      event('user_prompt', { text: 'fix it', source: 'user' }),
      event('tool_call_requested', { callId: 'edit-1', name: 'Edit', input: {} }),
      event('tool_result', { callId: 'edit-1', ok: true }),
    ];
    const answerEvents = [
      event('user_prompt', { text: 'explain it', source: 'user' }),
      event('assistant_message', { content: 'done', stopReason: 'end_turn', source: 'model' }),
    ];
    expect(deriveRunStage(actionEvents, true, false)).toBe('verify');
    expect(deriveRunStage(answerEvents, false, false)).toBe('verify');
  });
});
