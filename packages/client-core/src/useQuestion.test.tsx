/**
 * useQuestion — the open Question of a chat and the answer being put together.
 * The question is read from the chat's own events (every client of the
 * conversation sees the same one); the answer goes out through the fake `api`
 * shim (the IPC transport).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { QUESTION_ASKED, QUESTION_PLUGIN_ID, type MoxxyEvent, type QuestionItem } from '@moxxy/sdk';
import { __setApiOverride } from './transport.js';
import { chatStore } from './chatStore.js';
import { useQuestion } from './useQuestion.js';

const colour: QuestionItem = {
  id: 'q1',
  question: 'Which colour?',
  options: [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
  ],
  multiSelect: false,
  allowOther: true,
};

let seq = 0;
function askIn(workspaceId: string, turnId: string, questionId = 'qa'): void {
  const event = {
    id: `ev-${workspaceId}-${seq}`,
    seq: seq++,
    ts: 0,
    sessionId: 's',
    turnId,
    type: 'plugin_event',
    source: 'system',
    pluginId: QUESTION_PLUGIN_ID,
    subtype: QUESTION_ASKED,
    payload: { questionId, questions: [colour] },
  } as unknown as MoxxyEvent;
  act(() => {
    chatStore.dispatch(workspaceId, { type: 'send_started', turnId });
    chatStore.dispatch(workspaceId, { type: 'event', event });
  });
}

function host(answer: () => Promise<void> = async () => undefined) {
  const invoke = vi.fn(async (cmd: string, _args: unknown) => {
    if (cmd !== 'session.answerQuestion') throw new Error(`unexpected ${cmd}`);
    return answer();
  });
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => {}) as MoxxyApi['subscribe'],
  });
  return invoke;
}

afterEach(() => {
  __setApiOverride(null);
});

describe('useQuestion', () => {
  it('shows the question of the running turn and sends the answer put together in the card', async () => {
    const invoke = host();
    askIn('w-q1', 't1');
    const { result } = renderHook(() => useQuestion('w-q1'));

    expect(result.current.question?.questionId).toBe('qa');
    expect(result.current.problem).toBe('No answer to "Which colour?".');

    act(() => result.current.choose(colour, 'blue'));
    expect(result.current.problem).toBeNull();
    await act(() => result.current.submit());

    expect(invoke).toHaveBeenCalledWith('session.answerQuestion', {
      workspaceId: 'w-q1',
      questionId: 'qa',
      answers: { q1: { selected: ['blue'] } },
    });
  });

  it('sends nothing while the answer does not fit the question yet', async () => {
    const invoke = host();
    askIn('w-q2', 't1');
    const { result } = renderHook(() => useQuestion('w-q2'));

    await act(() => result.current.submit());

    expect(invoke).not.toHaveBeenCalled();
  });

  it('says so when another client answered first', async () => {
    host(async () => {
      throw new Error('This question is no longer open.');
    });
    askIn('w-q3', 't1');
    const { result } = renderHook(() => useQuestion('w-q3'));

    act(() => result.current.type(colour, 'Teal'));
    await act(() => result.current.submit());

    await waitFor(() => expect(result.current.error).toBe('This question is no longer open.'));
    expect(result.current.sending).toBe(false);
  });

  it('starts a fresh answer for the next question', () => {
    host();
    askIn('w-q4', 't1', 'first');
    const { result } = renderHook(() => useQuestion('w-q4'));
    act(() => result.current.choose(colour, 'red'));

    act(() => chatStore.dispatch('w-q4', { type: 'turn_complete', turnId: 't1', error: null }));
    askIn('w-q4', 't2', 'second');

    expect(result.current.question?.questionId).toBe('second');
    expect(result.current.draft).toEqual({ q1: { selected: [], other: '' } });
  });

  it('shows nothing in a chat with no workspace', () => {
    host();
    const { result } = renderHook(() => useQuestion(null));

    expect(result.current.question).toBeNull();
  });
});
