import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from './events.js';
import {
  QUESTION_ASKED,
  QUESTION_PLUGIN_ID,
  QUESTION_RESOLVED,
  describeQuestionAnswers,
  openQuestionsFromEvents,
  questionAnswersProblem,
  questionRecord,
  type QuestionItem,
} from './question.js';

let seq = 0;
const base = (turnId = 't1') => ({ id: `e${seq}`, seq: seq++, ts: 0, sessionId: 's', turnId }) as const;
const record = (subtype: string, payload: unknown, turnId?: string): MoxxyEvent =>
  ({ ...base(turnId), type: 'plugin_event', source: 'system', pluginId: QUESTION_PLUGIN_ID, subtype, payload }) as unknown as MoxxyEvent;
const prompt = (): MoxxyEvent => ({ ...base(), type: 'user_prompt', source: 'user', text: 'hi' }) as unknown as MoxxyEvent;

const colour: QuestionItem = {
  id: 'q1',
  header: 'Colour',
  question: 'Which colour should the button be?',
  options: [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue', description: 'Matches the logo' },
  ],
  multiSelect: false,
  allowOther: true,
};
const features: QuestionItem = {
  id: 'q2',
  question: 'Which parts should it cover?',
  options: [
    { id: 'auth', label: 'Auth' },
    { id: 'billing', label: 'Billing' },
  ],
  multiSelect: true,
  allowOther: false,
};

describe('question records in the log', () => {
  it('reads an asked and a resolved record, and nothing else', () => {
    expect(questionRecord(record(QUESTION_ASKED, { questionId: 'x', questions: [colour] }))).toEqual({
      kind: 'asked',
      questionId: 'x',
      turnId: 't1',
      questions: [colour],
    });
    expect(questionRecord(record(QUESTION_RESOLVED, { questionId: 'x', answers: { q1: { selected: ['red'] } } }))).toEqual({
      kind: 'resolved',
      questionId: 'x',
      outcome: { kind: 'answered', answers: { q1: { selected: ['red'] } } },
    });
    expect(questionRecord(record(QUESTION_RESOLVED, { questionId: 'x', dismissed: 'cancelled' }))).toEqual({
      kind: 'resolved',
      questionId: 'x',
      outcome: { kind: 'dismissed', reason: 'cancelled' },
    });
    expect(questionRecord(prompt())).toBeNull();
    expect(questionRecord(record('other', { questionId: 'x' }))).toBeNull();
    expect(questionRecord(record(QUESTION_ASKED, { questionId: 'x', questions: 'nope' }))).toBeNull();
  });

  it('keeps open only the questions nothing has resolved yet, in the order they were asked', () => {
    const events = [
      record(QUESTION_ASKED, { questionId: 'a', questions: [colour] }, 't1'),
      prompt(),
      record(QUESTION_ASKED, { questionId: 'b', questions: [features] }, 't2'),
      record(QUESTION_RESOLVED, { questionId: 'a', dismissed: 'cancelled' }),
      record(QUESTION_ASKED, { questionId: 'c', questions: [colour] }, 't3'),
    ];
    expect(openQuestionsFromEvents(events).map((q) => [q.questionId, q.turnId])).toEqual([
      ['b', 't2'],
      ['c', 't3'],
    ]);
  });

  it('has no open question in a conversation that never asked one', () => {
    expect(openQuestionsFromEvents([prompt(), prompt()])).toEqual([]);
  });
});

describe('checking an answer against its question', () => {
  const questions = [colour, features];

  it('accepts one choice, an answer of the person own, or several choices where allowed', () => {
    expect(questionAnswersProblem(questions, { q1: { selected: ['blue'] }, q2: { selected: ['auth', 'billing'] } })).toBeNull();
    expect(questionAnswersProblem(questions, { q1: { selected: [], other: 'Teal' }, q2: { selected: ['auth'] } })).toBeNull();
  });

  it('names what is wrong with an answer the question cannot take', () => {
    expect(questionAnswersProblem(questions, { q1: { selected: ['blue'] } })).toBe('No answer to "Which parts should it cover?".');
    expect(questionAnswersProblem(questions, { q1: { selected: ['red', 'blue'] }, q2: { selected: ['auth'] } })).toBe(
      '"Which colour should the button be?" takes one answer.',
    );
    expect(questionAnswersProblem(questions, { q1: { selected: ['green'] }, q2: { selected: ['auth'] } })).toBe(
      '"Which colour should the button be?" has no answer "green".',
    );
    expect(questionAnswersProblem(questions, { q1: { selected: ['red'] }, q2: { selected: [], other: 'Logs' } })).toBe(
      '"Which parts should it cover?" takes only the answers it offers.',
    );
    expect(questionAnswersProblem(questions, { q1: { selected: [], other: '   ' }, q2: { selected: ['auth'] } })).toBe(
      'No answer to "Which colour should the button be?".',
    );
    expect(questionAnswersProblem(questions, { q1: { selected: ['red'], other: 'Teal' }, q2: { selected: ['auth'] } })).toBe(
      '"Which colour should the button be?" takes one answer.',
    );
    expect(
      questionAnswersProblem(questions, { q1: { selected: ['red'] }, q2: { selected: ['auth'] }, q9: { selected: [] } }),
    ).toBe('There is no question "q9".');
  });
});

describe('telling the agent what the person answered', () => {
  it('quotes each question with the labels chosen and the words typed', () => {
    expect(
      describeQuestionAnswers([colour, features], {
        q1: { selected: [], other: 'Teal' },
        q2: { selected: ['auth', 'billing'] },
      }),
    ).toBe(
      [
        'The user answered:',
        '- "Which colour should the button be?" → their own answer: Teal',
        '- "Which parts should it cover?" → Auth, Billing',
      ].join('\n'),
    );
  });
});
