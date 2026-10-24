import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { defineTool, openQuestionsFromEvents, type QuestionItem, type QuestionOutcome } from '@moxxy/sdk';
import { Session } from '../session.js';
import { EventLog } from '../events/log.js';

const colour: QuestionItem = {
  id: 'q1',
  question: 'Which colour?',
  options: [{ id: 'red', label: 'Red' }],
  multiSelect: false,
  allowOther: true,
};

function sessionWithAskingTool() {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.tools.register(
    defineTool({
      name: 'asks',
      description: 'Asks the person one question.',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => {
        if (!ctx.ask) return 'no ask';
        return ctx.ask([colour]);
      },
    }),
  );
  return session;
}

describe('questions in a session', () => {
  it('lets a tool running in a turn ask, and the answer given through the session reaches it', async () => {
    const session = sessionWithAskingTool();
    session.questions.attachSurface();

    const running = session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't7' });
    await new Promise((resolve) => setImmediate(resolve));
    const [open] = openQuestionsFromEvents(session.log.slice());
    expect(open?.turnId).toBe('t7');
    await session.questions.answer(String(open?.questionId), { q1: { selected: ['red'] } });

    await expect(running).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['red'] } } } satisfies QuestionOutcome);
  });

  it('gives a tool called outside any turn no way to ask', async () => {
    const session = sessionWithAskingTool();

    await expect(session.tools.execute('asks', {}, new AbortController().signal)).resolves.toBe('no ask');
  });

  it('closes, on resume, a question an earlier run left open, so no client offers it for an answer', async () => {
    const before = sessionWithAskingTool();
    before.questions.attachSurface();
    void before.tools.execute('asks', {}, new AbortController().signal, { turnId: 't7' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(openQuestionsFromEvents(before.log.slice())).toHaveLength(1);

    const resumed = new Session({ cwd: '/tmp', silent: true, log: new EventLog(before.log.slice()) });

    expect(openQuestionsFromEvents(resumed.log.slice())).toEqual([]);
    expect(resumed.log.slice().at(-1)).toMatchObject({ subtype: 'question_resolved', turnId: 't7', payload: { dismissed: 'cancelled' } });
  });
});
