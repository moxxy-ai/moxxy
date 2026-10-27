/**
 * A chat bot's Questions, end to end against a real session: a tool asks, the
 * bot gets a card with buttons, clicks and typed words put the answer
 * together, and the answer reaches the tool. Every surface reads the same
 * question from the log, so an answer given elsewhere closes the bot's card.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '@moxxy/core';
import { QUESTION_CLOSED_AGENT_WENT_ON, asTurnId, defineTool, z, type QuestionItem, type QuestionOutcome } from '@moxxy/sdk';
import { ChatQuestions, type QuestionUpdate } from './questions.js';

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
const parts: QuestionItem = {
  id: 'q2',
  question: 'Which parts should it cover?',
  options: [
    { id: 'auth', label: 'Auth' },
    { id: 'billing', label: 'Billing' },
  ],
  multiSelect: true,
  allowOther: false,
};

function setUp(questions: ReadonlyArray<QuestionItem>) {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.tools.register(
    defineTool({
      name: 'asks',
      description: 'Asks the person.',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => (ctx.ask ? ctx.ask(questions) : 'no ask'),
    }),
  );
  const updates: QuestionUpdate[] = [];
  const desk = new ChatQuestions(() => session);
  const detach = desk.attach((update) => updates.push(update));
  const asked = session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' }) as Promise<QuestionOutcome>;
  return { session, desk, detach, updates, asked };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function lastCard(updates: ReadonlyArray<QuestionUpdate>) {
  const last = updates.at(-1);
  if (!last || last.kind === 'problem') throw new Error('expected a card');
  return last.card;
}

describe('ChatQuestions', () => {
  it('shows a new question as a card: the question, its answers as buttons, and a hint to reply in words', async () => {
    const { updates } = setUp([colour]);
    await settle();

    expect(updates.map((u) => u.kind)).toEqual(['show']);
    const card = lastCard(updates);
    expect(card.text).toContain('Colour: Which colour should the button be?');
    expect(card.text).toContain('Blue (Matches the logo)');
    expect(card.text).toContain('Or reply with your own answer.');
    expect(card.rows.flat().map((b) => b.label)).toEqual(['Red', 'Blue']);
  });

  it('answers a single one-answer question with one click and closes the card', async () => {
    const { desk, updates, asked } = setUp([colour]);
    await settle();
    const blue = lastCard(updates).rows.flat()[1];
    if (!blue) throw new Error('expected the Blue button');

    await desk.press(blue.data);

    await expect(asked).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['blue'] } } });
    const closed = lastCard(updates);
    expect(updates.at(-1)?.kind).toBe('closed');
    expect(closed.rows).toEqual([]);
    expect(closed.text).toContain('Answered: Blue');
  });

  it('collects several questions, marking picks, and sends them together with Send', async () => {
    const { desk, updates, asked } = setUp([colour, parts]);
    await settle();
    const data = (label: string) => {
      const button = lastCard(updates).rows.flat().find((b) => b.label.endsWith(label));
      if (!button) throw new Error(`no button ${label}`);
      return button.data;
    };

    await desk.press(data('Red'));
    await desk.press(data('Auth'));
    await desk.press(data('Billing'));
    expect(lastCard(updates).rows.flat().filter((b) => b.chosen).map((b) => b.label)).toEqual(['✓ Red', '✓ Auth', '✓ Billing']);
    await desk.press(data('Send'));

    await expect(asked).resolves.toEqual({
      kind: 'answered',
      answers: { q1: { selected: ['red'] }, q2: { selected: ['auth', 'billing'] } },
    });
  });

  it('says why Send did not go out while a question has no answer', async () => {
    const { desk, updates } = setUp([colour, parts]);
    await settle();
    const send = lastCard(updates).rows.flat().find((b) => b.label === 'Send');
    if (!send) throw new Error('expected Send');

    await desk.press(send.data);

    expect(updates.at(-1)).toEqual({ kind: 'problem', text: 'No answer to "Which colour should the button be?".' });
  });

  it('takes a typed reply as the answer of the person own, and lets other text through when nothing is open', async () => {
    const { desk, asked } = setUp([colour]);
    await settle();

    await expect(desk.typed('Teal')).resolves.toBe(true);
    await expect(asked).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: [], other: 'Teal' } } });
    await expect(desk.typed('and now something else')).resolves.toBe(false);
  });

  it('closes its card when the question was answered on another surface', async () => {
    const { session, updates } = setUp([colour]);
    await settle();
    const card = lastCard(updates);

    await session.questions.answer(card.questionId, { q1: { selected: ['red'] } });

    expect(updates.at(-1)?.kind).toBe('closed');
    expect(lastCard(updates).text).toContain('Answered: Red');
  });

  it('says on its closed card that a new message was sent instead of an answer', async () => {
    const { session, updates } = setUp([colour]);
    await settle();

    await session.questions.closeOnNewMessage(asTurnId('t2'));

    expect(updates.at(-1)?.kind).toBe('closed');
    expect(lastCard(updates).text).toContain('✕ Closed: a new message was sent instead.');
  });

  it('says on its closed card that the agent went on without the answer', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const updates: QuestionUpdate[] = [];
    new ChatQuestions(() => session).attach((update) => updates.push(update));
    const wentOn = new AbortController();
    const asked = session.questions.ask({ turnId: asTurnId('t1'), questions: [colour], signal: wentOn.signal });
    await settle();

    wentOn.abort(QUESTION_CLOSED_AGENT_WENT_ON);
    await asked;

    expect(lastCard(updates).text).toContain('✕ Closed: the agent went on without an answer.');
  });

  it('turns away a click on a card whose question is gone', async () => {
    const { desk, updates, session } = setUp([colour]);
    await settle();
    const red = lastCard(updates).rows.flat()[0];
    if (!red) throw new Error('expected Red');
    await session.questions.answer(lastCard(updates).questionId, { q1: { selected: ['blue'] } });

    await desk.press(red.data);

    expect(updates.at(-1)).toEqual({ kind: 'problem', text: 'This question is no longer open.' });
  });

  it('stops showing questions once detached, so tools hear nobody will answer', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    const desk = new ChatQuestions(() => session);
    desk.attach(() => undefined)();

    expect(session.questions.surfaceCount).toBe(0);
  });
});
