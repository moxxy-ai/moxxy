/**
 * The terminal end to end, without the screen: a tool asks through a real
 * session, the terminal finds the open Question in the events, the keys put
 * the answer together and it goes back through the session to the tool.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { defineTool, z, type QuestionItem } from '@moxxy/sdk';
import { flowKey, startFlow } from './question-flow.js';
import { attachQuestions, openQuestionIn, sendAnswer } from './question-session.js';

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

function askingSession() {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.tools.register(
    defineTool({
      name: 'asks',
      description: 'Asks the person one question.',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => (ctx.ask ? ctx.ask([colour]) : 'no ask'),
    }),
  );
  return session;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('a Question answered in the terminal', () => {
  it('reaches the tool that asked, with the answer picked by keys', async () => {
    const session = askingSession();
    attachQuestions(session);
    const running = session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' });
    await settle();

    const question = openQuestionIn(session.log.slice());
    if (!question) throw new Error('expected an open question');
    const picked = flowKey(flowKey(startFlow(question), question, { kind: 'down' }).flow, question, { kind: 'enter' });
    if (!picked.answers) throw new Error('expected the answer to go out');

    await expect(sendAnswer(session, question.questionId, picked.answers)).resolves.toBeNull();
    await expect(running).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['blue'] } } });
    expect(openQuestionIn(session.log.slice())).toBeNull();
  });

  it('says why when the answer did not go through (answered elsewhere first)', async () => {
    const session = askingSession();
    attachQuestions(session);
    void session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' });
    await settle();
    const question = openQuestionIn(session.log.slice());
    if (!question) throw new Error('expected an open question');
    await session.questions.answer(question.questionId, { q1: { selected: ['red'] } });

    await expect(sendAnswer(session, question.questionId, { q1: { selected: ['blue'] } })).resolves.toBe(
      'This question is no longer open.',
    );
  });

  it('is told nobody answers once the terminal lets go of questions', async () => {
    const session = askingSession();
    const detach = attachQuestions(session);
    detach();

    await expect(session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' })).resolves.toEqual({
      kind: 'unanswerable',
    });
  });
});
