import { describe, expect, it } from 'vitest';
import type { QuestionItem } from './question.js';
import { chooseOption, draftAnswers, emptyDraft, typeOwnAnswer } from './question-draft.js';

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
  allowOther: true,
};

describe('answering in the card', () => {
  it('takes one choice where only one fits, replacing the earlier one and any typed answer', () => {
    let draft = typeOwnAnswer(emptyDraft([colour]), colour, 'Teal');
    draft = chooseOption(draft, colour, 'red');
    draft = chooseOption(draft, colour, 'blue');

    expect(draftAnswers(draft)).toEqual({ q1: { selected: ['blue'] } });
  });

  it('toggles choices where several fit, and keeps typed words beside them', () => {
    let draft = emptyDraft([parts]);
    draft = chooseOption(draft, parts, 'auth');
    draft = chooseOption(draft, parts, 'billing');
    draft = chooseOption(draft, parts, 'auth');
    draft = typeOwnAnswer(draft, parts, 'Logs');

    expect(draftAnswers(draft)).toEqual({ q2: { selected: ['billing'], other: 'Logs' } });
  });

  it('lets typed words stand alone as the one answer, clearing the choice', () => {
    let draft = chooseOption(emptyDraft([colour]), colour, 'red');
    draft = typeOwnAnswer(draft, colour, 'Teal');

    expect(draftAnswers(draft)).toEqual({ q1: { selected: [], other: 'Teal' } });
  });

  it('sends no empty typed answer', () => {
    const draft = typeOwnAnswer(chooseOption(emptyDraft([parts]), parts, 'auth'), parts, '   ');

    expect(draftAnswers(draft)).toEqual({ q2: { selected: ['auth'] } });
  });
});
