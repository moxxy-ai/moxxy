/**
 * useSessionActivity — what each chat is doing. A chat whose running turn
 * asked the person a Question is stopped on them, the same as one waiting on
 * an approval.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { chatStore } from '@moxxy/client-core';
import { QUESTION_ASKED, QUESTION_PLUGIN_ID, QUESTION_RESOLVED, type MoxxyEvent } from '@moxxy/sdk';
import { useSessionActivity } from './useSessionActivity';

let seq = 0;
function record(workspaceId: string, turnId: string, subtype: string, payload: unknown): void {
  const event = {
    id: `ev-${workspaceId}-${seq}`,
    seq: seq++,
    ts: 0,
    sessionId: 's',
    turnId,
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

describe('useSessionActivity', () => {
  it('counts a chat whose running turn asked a Question as stopped on the person, until it is answered', () => {
    act(() => chatStore.dispatch('w-act', { type: 'send_started', turnId: 't1' }));
    const { result } = renderHook(() => useSessionActivity(new Set(['w-act'])));
    expect(result.current.get('w-act')).toBe('working');

    record('w-act', 't1', QUESTION_ASKED, { questionId: 'qa', questions: [colour] });
    expect(result.current.get('w-act')).toBe('asking');

    record('w-act', 't1', QUESTION_RESOLVED, { questionId: 'qa', answers: { q1: { selected: ['red'] } } });
    expect(result.current.get('w-act')).toBe('working');
  });
});
