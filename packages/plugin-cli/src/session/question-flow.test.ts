import { describe, expect, it } from 'vitest';
import type { OpenQuestion, QuestionItem } from '@moxxy/sdk';
import { flowKey, questionRows, startFlow, type FlowKey, type QuestionFlow } from './question-flow.js';

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
const parts: QuestionItem = {
  id: 'q2',
  question: 'Which parts?',
  options: [
    { id: 'auth', label: 'Auth' },
    { id: 'billing', label: 'Billing' },
  ],
  multiSelect: true,
  allowOther: false,
};
const both: OpenQuestion = { questionId: 'qa', turnId: 't1', questions: [colour, parts] };

/** Press keys in order; the answer, once one goes out, is kept. */
function press(question: OpenQuestion, keys: ReadonlyArray<FlowKey>, from: QuestionFlow = startFlow(question)) {
  let flow = from;
  let sent: unknown = null;
  for (const key of keys) {
    const next = flowKey(flow, question, key);
    flow = next.flow;
    if (next.answers) sent = next.answers;
  }
  return { flow, sent };
}

describe('answering a Question in the terminal', () => {
  it('offers the suggested answers and, where the question takes one, a row to write one of your own', () => {
    expect(questionRows(colour).map((row) => row.label)).toEqual(['Red', 'Blue', 'Write my own answer']);
    expect(questionRows(parts).map((row) => row.label)).toEqual(['Auth', 'Billing']);
  });

  it('walks the questions one at a time and sends them all together after the last one', () => {
    const { flow, sent } = press(both, [
      { kind: 'down' },
      { kind: 'enter' }, // Blue, next question
      { kind: 'space' }, // Auth
      { kind: 'down' },
      { kind: 'space' }, // Billing
      { kind: 'enter' }, // done
    ]);

    expect(sent).toEqual({ q1: { selected: ['blue'] }, q2: { selected: ['auth', 'billing'] } });
    expect(flow.step).toBe(1);
  });

  it('takes the answer under the cursor when Enter leaves a several-answers question with none picked', () => {
    const { sent } = press(both, [{ kind: 'enter' }, { kind: 'down' }, { kind: 'enter' }]);

    expect(sent).toEqual({ q1: { selected: ['red'] }, q2: { selected: ['billing'] } });
  });

  it('takes an answer of your own, typed on its row, in place of a choice', () => {
    const own: OpenQuestion = { questionId: 'qb', turnId: 't1', questions: [colour] };
    const { sent } = press(own, [
      { kind: 'down' },
      { kind: 'down' },
      { kind: 'enter' }, // start typing
      { kind: 'text', text: 'Tea' },
      { kind: 'text', text: 'lx' },
      { kind: 'backspace' },
      { kind: 'enter' },
    ]);

    expect(sent).toEqual({ q1: { selected: [], other: 'Teal' } });
  });

  it('keeps a pasted answer on one line', () => {
    const own: OpenQuestion = { questionId: 'qb', turnId: 't1', questions: [colour] };
    const { sent } = press(own, [{ kind: 'up' }, { kind: 'enter' }, { kind: 'text', text: 'dark\nteal' }, { kind: 'enter' }]);

    expect(sent).toEqual({ q1: { selected: [], other: 'dark teal' } });
  });

  it('steps back with Escape: out of typing first, then to the question before; never answers for you', () => {
    let { flow } = press(both, [{ kind: 'enter' }, { kind: 'escape' }]);
    expect(flow.step).toBe(0);

    ({ flow } = press(both, [{ kind: 'up' }, { kind: 'enter' }, { kind: 'text', text: 'x' }, { kind: 'escape' }]));
    expect(flow.typing).toBeNull();
    expect(flow.draft.q1).toEqual({ selected: [], other: '' });

    const first = press(both, [{ kind: 'escape' }]);
    expect(first.flow.step).toBe(0);
    expect(first.sent).toBeNull();
  });

  it('sends nothing empty: Enter on an empty own answer keeps you typing', () => {
    const own: OpenQuestion = { questionId: 'qb', turnId: 't1', questions: [colour] };
    const { flow, sent } = press(own, [{ kind: 'up' }, { kind: 'enter' }, { kind: 'enter' }]);

    expect(sent).toBeNull();
    expect(flow.typing).toBe('');
  });

  it('wraps the cursor around the rows', () => {
    expect(press(both, [{ kind: 'up' }]).flow.cursor).toBe(2);
    expect(press(both, [{ kind: 'up' }, { kind: 'down' }]).flow.cursor).toBe(0);
  });
});
