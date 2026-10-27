/**
 * Claude's AskUserQuestion shown as a Moxxy Question, and the person's answer
 * handed back the way Claude reads it (keyed by the question text, labels
 * joined, an answer of their own as written).
 */
import { describe, expect, it } from 'vitest';
import { fromClaudeQuestions, toClaudeAnswers } from './questions.js';

const asked = {
  questions: [
    {
      question: 'Which colour should the button be?',
      header: 'Button colour',
      multiSelect: false,
      options: [
        { label: 'Red', description: 'Make the button red.' },
        { label: 'Blue', description: 'Make the button blue.' },
      ],
    },
    { question: 'Which sizes?', header: 'Sizes', multiSelect: true, options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] },
  ],
};

describe('a Claude question in Moxxy', () => {
  it('keeps the question, its tag, its options and whether several fit; an answer of their own is always allowed', () => {
    expect(fromClaudeQuestions(asked)).toEqual([
      {
        id: 'q0',
        header: 'Button colour',
        question: 'Which colour should the button be?',
        options: [
          { id: 'q0o0', label: 'Red', description: 'Make the button red.' },
          { id: 'q0o1', label: 'Blue', description: 'Make the button blue.' },
        ],
        multiSelect: false,
        allowOther: true,
      },
      {
        id: 'q1',
        header: 'Sizes',
        question: 'Which sizes?',
        options: [
          { id: 'q1o0', label: 'S' },
          { id: 'q1o1', label: 'M' },
          { id: 'q1o2', label: 'L' },
        ],
        multiSelect: true,
        allowOther: true,
      },
    ]);
  });

  it('reads nothing it cannot show', () => {
    expect(fromClaudeQuestions({ questions: 'no' })).toEqual([]);
    expect(fromClaudeQuestions(null)).toEqual([]);
  });

  it('hands the answers back keyed by the question, as Claude expects', () => {
    const items = fromClaudeQuestions(asked);

    expect(
      toClaudeAnswers(items, {
        q0: { selected: [], other: 'Teal, my own answer' },
        q1: { selected: ['q1o0', 'q1o2'] },
      }),
    ).toEqual({ 'Which colour should the button be?': 'Teal, my own answer', 'Which sizes?': 'S, L' });
  });
});
