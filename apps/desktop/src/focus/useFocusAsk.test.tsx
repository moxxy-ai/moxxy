/**
 * useFocusAsk — what the focus window shows the person is waiting on: an
 * approval, or a Question the agent asked. Both stop the turn on the person,
 * so the small card beside the mark and the Mini Chat show either.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chatStore } from '@moxxy/client-core';
import { QUESTION_ASKED, QUESTION_PLUGIN_ID, QUESTION_RESOLVED, type MoxxyEvent } from '@moxxy/sdk';
import { useFocusAsk } from './useFocusAsk';

let seq = 0;
function record(workspaceId: string, subtype: string, payload: unknown): void {
  const event = {
    id: `ev-focus-${seq}`,
    seq: seq++,
    ts: 0,
    sessionId: 's',
    turnId: 't1',
    type: 'plugin_event',
    source: 'system',
    pluginId: QUESTION_PLUGIN_ID,
    subtype,
    payload,
  } as unknown as MoxxyEvent;
  act(() => chatStore.dispatch(workspaceId, { type: 'event', event }));
}

const colour = {
  id: 'q1',
  question: 'Which colour?',
  options: [{ id: 'red', label: 'Red' }],
  multiSelect: false,
  allowOther: true,
};

describe('useFocusAsk', () => {
  it('hands the focus window the Question the running turn asked, until it is answered', () => {
    act(() => chatStore.dispatch('w-focus', { type: 'send_started', turnId: 't1' }));
    const { result } = renderHook(() => useFocusAsk('w-focus'));
    expect(result.current).toBeNull();

    record('w-focus', QUESTION_ASKED, { questionId: 'qf', questions: [colour] });
    const ask = result.current;
    expect(ask?.kind).toBe('question');
    if (ask?.kind !== 'question') throw new Error('expected a question');
    expect(ask.question.question?.questionId).toBe('qf');

    record('w-focus', QUESTION_RESOLVED, { questionId: 'qf', answers: { q1: { selected: ['red'] } } });
    expect(result.current).toBeNull();
  });
});
