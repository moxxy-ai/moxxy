import { describe, expect, it } from 'vitest';
import type { CollectedToolUse, MoxxyEvent } from '@moxxy/sdk';

import { detectGoalTerminal } from './completion.js';
import { GOAL_ABANDON_TOOL, GOAL_COMPLETE_TOOL } from './constants.js';

// Minimal tool_result stand-in — detectGoalTerminal only reads type/ok/callId.
function result(callId: string, ok: boolean): MoxxyEvent {
  return { type: 'tool_result', callId, ok } as unknown as MoxxyEvent;
}
function use(id: string, name: string, input: unknown): CollectedToolUse {
  return { id, name, input };
}

describe('detectGoalTerminal', () => {
  it('returns null when the batch has no goal tools', () => {
    const log = [result('c1', true)];
    expect(detectGoalTerminal(log, [use('c1', 'Bash', {})])).toBeNull();
  });

  it('detects a successful goal_complete and parses summary + evidence', () => {
    const batch = [use('c1', GOAL_COMPLETE_TOOL, { summary: 'shipped', evidence: ['tests pass', 'built'] })];
    const out = detectGoalTerminal([result('c1', true)], batch);
    expect(out).toEqual({ kind: 'complete', summary: 'shipped', evidence: ['tests pass', 'built'] });
  });

  it('detects goal_abandon with reason + needsFromUser', () => {
    const batch = [use('c2', GOAL_ABANDON_TOOL, { reason: 'missing key', needsFromUser: 'set API_KEY' })];
    const out = detectGoalTerminal([result('c2', true)], batch);
    expect(out).toEqual({ kind: 'abandon', reason: 'missing key', needsFromUser: 'set API_KEY' });
  });

  it('ignores a goal tool whose result failed (e.g. hook-denied)', () => {
    const batch = [use('c3', GOAL_COMPLETE_TOOL, { summary: 'x' })];
    expect(detectGoalTerminal([result('c3', false)], batch)).toBeNull();
  });

  it('only reacts to its OWN call ids (not a same-name result from elsewhere)', () => {
    const batch = [use('c4', GOAL_COMPLETE_TOOL, { summary: 'x' })];
    // A successful result exists, but for a different callId.
    expect(detectGoalTerminal([result('other', true)], batch)).toBeNull();
  });

  it('defaults summary/reason when the model omitted them', () => {
    const out = detectGoalTerminal([result('c5', true)], [use('c5', GOAL_COMPLETE_TOOL, {})]);
    expect(out).toEqual({ kind: 'complete', summary: 'Goal completed.', evidence: [] });
  });

  it('drops non-string evidence elements from raw (unvalidated) model input', () => {
    // `input` is the RAW provider-emitted tool input — the model can put
    // anything in `evidence`. Non-string elements must be filtered out, not
    // unsafely cast to string[].
    const batch = [
      use('c6', GOAL_COMPLETE_TOOL, {
        summary: 'done',
        evidence: ['tests pass', 1, { a: 1 }, null, 'built'],
      }),
    ];
    const out = detectGoalTerminal([result('c6', true)], batch);
    expect(out).toEqual({ kind: 'complete', summary: 'done', evidence: ['tests pass', 'built'] });
  });

  it('coerces a non-string summary to the default', () => {
    const batch = [use('c7', GOAL_COMPLETE_TOOL, { summary: 42, evidence: [] })];
    const out = detectGoalTerminal([result('c7', true)], batch);
    expect(out).toEqual({ kind: 'complete', summary: 'Goal completed.', evidence: [] });
  });
});
