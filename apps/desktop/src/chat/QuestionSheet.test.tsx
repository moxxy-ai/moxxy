/**
 * The sheet puts the Question card above the composer and takes the keyboard
 * into it, onto the first suggested answer, the way the approval card does.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQuestion } from '@moxxy/client-core';
import { QuestionSheet } from './QuestionSheet';

const asked: UseQuestion = {
  question: {
    questionId: 'qa',
    turnId: 't1',
    questions: [
      {
        id: 'q1',
        question: 'Which colour?',
        options: [
          { id: 'red', label: 'Red' },
          { id: 'blue', label: 'Blue' },
        ],
        multiSelect: false,
        allowOther: true,
      },
    ],
  },
  draft: { q1: { selected: [], other: '' } },
  problem: 'No answer to "Which colour?".',
  sending: false,
  error: null,
  choose: vi.fn(),
  type: vi.fn(),
  submit: vi.fn(async () => undefined),
};

describe('QuestionSheet', () => {
  it('takes the keyboard onto the first suggested answer', () => {
    render(<QuestionSheet question={asked} />);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Red' }));
  });

  it('draws nothing when no question is open', () => {
    const { container } = render(<QuestionSheet question={{ ...asked, question: null }} />);

    expect(container).toBeEmptyDOMElement();
  });
});
