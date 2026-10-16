import { describe, expect, it } from 'vitest';
import { QUESTION_ASKED, QUESTION_PLUGIN_ID, QUESTION_RESOLVED, type MoxxyEvent, type QuestionItem } from '@moxxy/sdk';
import { pendingQuestion } from './question-draft.js';
import { isRenderedEvent } from './chatModel.js';

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
const record = (subtype: string, payload: unknown, turnId = 't1'): MoxxyEvent =>
  ({
    id: `e${seq}`,
    seq: seq++,
    ts: 0,
    sessionId: 's',
    turnId,
    type: 'plugin_event',
    source: 'system',
    pluginId: QUESTION_PLUGIN_ID,
    subtype,
    payload,
  }) as unknown as MoxxyEvent;

describe('the question a chat shows', () => {
  it('keeps question records in the chat, which renders nothing of them itself', () => {
    expect(isRenderedEvent(record(QUESTION_ASKED, { questionId: 'a', questions: [colour] }))).toBe(true);
  });

  it('is the open question of the turn running now', () => {
    const events = [record(QUESTION_ASKED, { questionId: 'a', questions: [colour] }, 't1')];

    expect(pendingQuestion(events, 't1')?.questionId).toBe('a');
  });

  it('is none once it was answered, or when its turn is not running (left over from a runner that stopped)', () => {
    const asked = record(QUESTION_ASKED, { questionId: 'a', questions: [colour] }, 't1');
    const answered = record(QUESTION_RESOLVED, { questionId: 'a', answers: { q1: { selected: ['red'] } } });

    expect(pendingQuestion([asked, answered], 't1')).toBeNull();
    expect(pendingQuestion([asked], null)).toBeNull();
    expect(pendingQuestion([asked], 't2')).toBeNull();
  });
});
