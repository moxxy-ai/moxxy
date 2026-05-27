import { describe, expect, it } from 'vitest';
import { EventLog } from './log.js';
import {
  selectCurrentTurn,
  selectPendingToolCalls,
} from './selectors.js';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';

const sid = asSessionId('s1');
const tid = asTurnId('t1');
const c1 = asToolCallId('c1');
const c2 = asToolCallId('c2');


describe('selectPendingToolCalls', () => {
  it('returns unresolved calls', async () => {
    const log = new EventLog();
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c1,
      name: 'Read',
      input: {},
    });
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c2,
      name: 'Bash',
      input: {},
    });
    await log.append({
      type: 'tool_result',
      sessionId: sid,
      turnId: tid,
      source: 'tool',
      callId: c1,
      ok: true,
      output: '',
    });
    const pending = selectPendingToolCalls(log);
    expect(pending.map((p) => p.callId)).toEqual([c2]);
  });

  it('clears pending on denial', async () => {
    const log = new EventLog();
    await log.append({
      type: 'tool_call_requested',
      sessionId: sid,
      turnId: tid,
      source: 'model',
      callId: c1,
      name: 'Bash',
      input: {},
    });
    await log.append({
      type: 'tool_call_denied',
      sessionId: sid,
      turnId: tid,
      source: 'system',
      callId: c1,
      decidedBy: 'resolver',
      reason: 'no',
    });
    expect(selectPendingToolCalls(log)).toHaveLength(0);
  });
});

describe('selectCurrentTurn', () => {
  it('returns most recent turnId', async () => {
    const log = new EventLog();
    expect(selectCurrentTurn(log)).toBeNull();
    await log.append({ type: 'user_prompt', sessionId: sid, turnId: tid, source: 'user', text: 'a' });
    expect(selectCurrentTurn(log)).toBe(tid);
  });
});

