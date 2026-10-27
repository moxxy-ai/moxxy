import { describe, expect, it } from 'vitest';
import { QUESTION_CLOSED_AGENT_WENT_ON, asSessionId, asTurnId, openQuestionsFromEvents, questionRecord, type QuestionItem } from '@moxxy/sdk';
import { EventLog } from '../events/log.js';
import { SessionQuestionsImpl } from './session-questions.js';

const colour: QuestionItem = {
  id: 'q1',
  question: 'Which colour should the button be?',
  options: [
    { id: 'red', label: 'Red' },
    { id: 'blue', label: 'Blue' },
  ],
  multiSelect: false,
  allowOther: true,
};

function setup() {
  const log = new EventLog();
  const questions = new SessionQuestionsImpl({ log, sessionId: asSessionId('s1') });
  const ask = (signal = new AbortController().signal) =>
    questions.ask({ turnId: asTurnId('t1'), questions: [colour], signal });
  const open = () => openQuestionsFromEvents(log.slice());
  const records = () => log.slice().map(questionRecord).filter((r) => r !== null);
  return { log, questions, ask, open, records };
}

/** Lets the asked record land before the test answers it. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('session questions', () => {
  it('tells the asker nobody will answer when no surface that shows questions is attached, and records nothing', async () => {
    const { ask, records } = setup();

    await expect(ask()).resolves.toEqual({ kind: 'unanswerable' });
    expect(records()).toEqual([]);
  });

  it('records the question, waits, and gives the asker the answer the person chose', async () => {
    const { questions, ask, open, records } = setup();
    questions.attachSurface();

    const pending = ask();
    await settle();
    const [asked] = open();
    expect(asked?.turnId).toBe('t1');
    expect(asked?.questions).toEqual([colour]);

    await questions.answer(String(asked?.questionId), { q1: { selected: ['blue'] } });

    await expect(pending).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['blue'] } } });
    expect(open()).toEqual([]);
    expect(records().map((r) => r.kind)).toEqual(['asked', 'resolved']);
  });

  it('turns away an answer that does not fit and keeps the question open', async () => {
    const { questions, ask, open } = setup();
    questions.attachSurface();
    void ask();
    await settle();
    const id = String(open()[0]?.questionId);

    await expect(questions.answer(id, { q1: { selected: ['green'] } })).rejects.toThrow(
      '"Which colour should the button be?" has no answer "green".',
    );
    expect(open()).toHaveLength(1);
  });

  it('takes one answer only: a second one, from any surface, is turned away', async () => {
    const { questions, ask, open, records } = setup();
    questions.attachSurface();
    const pending = ask();
    await settle();
    const id = String(open()[0]?.questionId);

    await questions.answer(id, { q1: { selected: ['red'] } });
    await expect(questions.answer(id, { q1: { selected: ['blue'] } })).rejects.toThrow('This question is no longer open.');

    await expect(pending).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['red'] } } });
    expect(records().map((r) => r.kind)).toEqual(['asked', 'resolved']);
  });

  it('closes the question when the turn waiting on it stops', async () => {
    const { questions, ask, open, records } = setup();
    questions.attachSurface();
    const stop = new AbortController();
    const pending = ask(stop.signal);
    await settle();
    const id = String(open()[0]?.questionId);

    stop.abort();

    await expect(pending).resolves.toEqual({ kind: 'dismissed', reason: 'cancelled' });
    expect(open()).toEqual([]);
    expect(records().at(-1)).toEqual({ kind: 'resolved', questionId: id, outcome: { kind: 'dismissed', reason: 'cancelled' } });
    await expect(questions.answer(id, { q1: { selected: ['red'] } })).rejects.toThrow('This question is no longer open.');
  });

  it('does not ask at all for a turn that has already stopped', async () => {
    const { questions, ask, records } = setup();
    questions.attachSurface();
    const stop = new AbortController();
    stop.abort();

    await expect(ask(stop.signal)).resolves.toEqual({ kind: 'dismissed', reason: 'cancelled' });
    expect(records()).toEqual([]);
  });

  it('turns away an answer to a question nobody waits on any more (asked before the runner restarted)', async () => {
    const before = setup();
    before.questions.attachSurface();
    void before.ask();
    await settle();
    const id = String(before.open()[0]?.questionId);

    const restarted = new SessionQuestionsImpl({ log: new EventLog(before.log.slice()), sessionId: asSessionId('s1') });

    await expect(restarted.answer(id, { q1: { selected: ['red'] } })).rejects.toThrow('This question is no longer open.');
  });

  it('closes a question with the reason its asker gave, and keeps the reason in the record', async () => {
    const { questions, ask, open, records } = setup();
    questions.attachSurface();
    const wentOn = new AbortController();
    const pending = ask(wentOn.signal);
    await settle();

    // The agent went on without the answer: nothing waits on the question any more.
    wentOn.abort(QUESTION_CLOSED_AGENT_WENT_ON);

    await expect(pending).resolves.toEqual({ kind: 'dismissed', reason: 'cancelled', note: 'agent-went-on' });
    expect(open()).toEqual([]);
    expect(records().at(-1)).toMatchObject({ kind: 'resolved', outcome: { kind: 'dismissed', note: 'agent-went-on' } });
  });

  it("closes a question an earlier turn still waits on when the person sends a new message, so that turn can end", async () => {
    const { log, questions, ask, open, records } = setup();
    questions.attachSurface();
    const pending = ask();
    await settle();

    await questions.closeOnNewMessage(asTurnId('t2'));

    await expect(pending).resolves.toEqual({ kind: 'dismissed', reason: 'cancelled', note: 'new-message' });
    expect(open()).toEqual([]);
    expect(records().at(-1)).toMatchObject({ kind: 'resolved', outcome: { note: 'new-message' } });
    // The record belongs to the turn that asked, as every surface reads it.
    expect(log.slice().at(-1)?.turnId).toBe('t1');
  });

  it("leaves the new message's own turn questions open", async () => {
    const { questions, ask, open } = setup();
    questions.attachSurface();
    void ask();
    await settle();

    await questions.closeOnNewMessage(asTurnId('t1'));

    expect(open()).toHaveLength(1);
  });

  it('counts surfaces: a detached surface no longer answers, and detaching twice changes nothing', async () => {
    const { questions, ask } = setup();
    const detachDesktop = questions.attachSurface();
    const detachBot = questions.attachSurface();

    detachDesktop();
    detachDesktop();
    expect(questions.surfaceCount).toBe(1);

    detachBot();
    await expect(ask()).resolves.toEqual({ kind: 'unanswerable' });
  });
});
