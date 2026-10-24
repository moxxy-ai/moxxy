import { describe, expect, it } from 'vitest';
import type { OpenQuestion } from '@moxxy/sdk';
import { questionCardView } from '../src/questionCardUi';

const question: OpenQuestion = {
  questionId: 'qa',
  turnId: 't1',
  questions: [
    {
      id: 'q1',
      header: 'Colour',
      question: 'Which colour?',
      options: [
        { id: 'red', label: 'Red' },
        { id: 'blue', label: 'Blue', description: 'Matches the logo' },
      ],
      multiSelect: false,
      allowOther: true,
    },
    {
      id: 'q2',
      question: 'Which parts?',
      options: [{ id: 'auth', label: 'Auth' }],
      multiSelect: true,
      allowOther: false,
    },
  ],
};

describe('mobile Question card', () => {
  it('shows each question with its answers, marking the picked ones, and a field only where words are taken', () => {
    const view = questionCardView(question, { q1: { selected: ['blue'], other: '' }, q2: { selected: [], other: '' } });

    expect(view.title).toBe('2 questions');
    expect(view.items).toEqual([
      {
        id: 'q1',
        header: 'Colour',
        question: 'Which colour?',
        hint: null,
        options: [
          { id: 'red', label: 'Red', description: null, chosen: false },
          { id: 'blue', label: 'Blue', description: 'Matches the logo', chosen: true },
        ],
        own: '',
        takesOwn: true,
      },
      {
        id: 'q2',
        header: null,
        question: 'Which parts?',
        hint: 'Choose any',
        options: [{ id: 'auth', label: 'Auth', description: null, chosen: false }],
        own: '',
        takesOwn: false,
      },
    ]);
  });

  it('names a lone question simply "Question"', () => {
    const lone: OpenQuestion = { ...question, questions: question.questions.slice(0, 1) };

    expect(questionCardView(lone, {}).title).toBe('Question');
  });
});
