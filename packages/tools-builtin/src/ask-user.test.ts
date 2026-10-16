import { describe, expect, it } from 'vitest';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import type { QuestionItem, QuestionOutcome, ToolContext } from '@moxxy/sdk';
import { askUserTool } from './ask-user.js';

/** The context a session turn gives the tool; `ask` stands in for the person at a surface. */
function contextAnswering(outcome: (questions: ReadonlyArray<QuestionItem>) => QuestionOutcome) {
  const asked: Array<ReadonlyArray<QuestionItem>> = [];
  const ctx: ToolContext = {
    sessionId: asSessionId('s'),
    turnId: asTurnId('t'),
    callId: asToolCallId('c'),
    cwd: '/tmp',
    signal: new AbortController().signal,
    log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    ask: async (questions) => {
      asked.push(questions);
      return outcome(questions);
    },
  };
  return { ctx, asked };
}

const input = askUserTool.inputSchema.parse({
  questions: [
    {
      question: 'Which colour should the button be?',
      header: 'Colour',
      options: [{ label: 'Red' }, { label: 'Blue', description: 'Matches the logo' }],
    },
    {
      question: 'Which parts should it cover?',
      options: [{ label: 'Auth' }, { label: 'Billing' }],
      multiSelect: true,
    },
  ],
});

describe('ask_user', () => {
  it('asks the questions as the agent wrote them, always taking an answer of the person own', async () => {
    const { ctx, asked } = contextAnswering(() => ({ kind: 'unanswerable' }));

    await askUserTool.handler(input, ctx);

    expect(asked[0]).toEqual([
      {
        id: 'q1',
        header: 'Colour',
        question: 'Which colour should the button be?',
        options: [
          { id: 'o1', label: 'Red' },
          { id: 'o2', label: 'Blue', description: 'Matches the logo' },
        ],
        multiSelect: false,
        allowOther: true,
      },
      {
        id: 'q2',
        question: 'Which parts should it cover?',
        options: [
          { id: 'o1', label: 'Auth' },
          { id: 'o2', label: 'Billing' },
        ],
        multiSelect: true,
        allowOther: true,
      },
    ]);
  });

  it('gives the agent the answers as text and keeps them for the transcript to show what the person chose', async () => {
    const { ctx } = contextAnswering(() => ({
      kind: 'answered',
      answers: { q1: { selected: [], other: 'Teal' }, q2: { selected: ['o1', 'o2'] } },
    }));

    await expect(askUserTool.handler(input, ctx)).resolves.toEqual({
      forModel: [
        'The user answered:',
        '- "Which colour should the button be?" → their own answer: Teal',
        '- "Which parts should it cover?" → Auth, Billing',
      ].join('\n'),
      display: {
        kind: 'question-answer',
        questions: [
          { header: 'Colour', question: 'Which colour should the button be?', chosen: [], own: 'Teal' },
          { question: 'Which parts should it cover?', chosen: ['Auth', 'Billing'] },
        ],
      },
    });
  });

  it('tells the agent to decide on its own when nobody can answer', async () => {
    const { ctx } = contextAnswering(() => ({ kind: 'unanswerable' }));
    const noSurface: ToolContext = { ...ctx, ask: undefined };

    const expected =
      'Nobody can answer questions here. Decide on your own, go on, and say which choices you made and why.';
    await expect(askUserTool.handler(input, ctx)).resolves.toBe(expected);
    await expect(askUserTool.handler(input, noSurface)).resolves.toBe(expected);
  });

  it('ends as stopped when the turn stops before anyone answers', async () => {
    const { ctx } = contextAnswering(() => ({ kind: 'dismissed', reason: 'cancelled' }));

    await expect(askUserTool.handler(input, ctx)).rejects.toThrow('The question was closed because the turn stopped.');
  });

  it('asks one to four questions with two to four suggested answers each', () => {
    const one = { question: 'Q?', options: [{ label: 'A' }, { label: 'B' }] };
    expect(askUserTool.inputSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(askUserTool.inputSchema.safeParse({ questions: [one, one, one, one, one] }).success).toBe(false);
    expect(askUserTool.inputSchema.safeParse({ questions: [{ ...one, options: [{ label: 'A' }] }] }).success).toBe(false);
    expect(askUserTool.inputSchema.safeParse({ questions: [one] }).success).toBe(true);
  });

  it('is not offered in goal mode, which runs unattended: there the agent decides and says what it chose', () => {
    expect(askUserTool.notInModes).toEqual(['goal']);
  });

  it('runs without asking leave: a question changes nothing', () => {
    expect(askUserTool.permission).toEqual({ action: 'allow' });
  });
});
