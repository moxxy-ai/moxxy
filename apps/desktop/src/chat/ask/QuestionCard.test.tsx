/**
 * The Question card draws what `useQuestion` holds and hands every pick, word
 * and send back to it. It decides nothing itself.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { OpenQuestion, QuestionItem } from '@moxxy/sdk';
import { QuestionCard } from './QuestionCard';

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
const question: OpenQuestion = { questionId: 'qa', turnId: 't1', questions: [colour, parts] };

function renderCard(overrides: Partial<Parameters<typeof QuestionCard>[0]> = {}) {
  const props = {
    question,
    draft: { q1: { selected: ['blue'], other: '' }, q2: { selected: [], other: '' } },
    problem: null,
    sending: false,
    error: null,
    onChoose: vi.fn(),
    onType: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<QuestionCard {...props} />);
  return props;
}

describe('QuestionCard', () => {
  it('names itself a Question and shows every question with its suggested answers', () => {
    renderCard();

    expect(screen.getByRole('dialog', { name: 'Question from the agent' })).toBeTruthy();
    expect(screen.getByText('Colour')).toBeTruthy();
    expect(screen.getByText('Which colour should the button be?')).toBeTruthy();
    expect(screen.getByText('Which parts should it cover?')).toBeTruthy();
    expect(screen.getByText('Matches the logo')).toBeTruthy();
    expect(screen.getByText('Choose any')).toBeTruthy();
  });

  it('marks the answers already picked and hands a new pick back', () => {
    const props = renderCard();

    expect(screen.getByRole('button', { name: /Blue/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Red/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Auth/ }));

    expect(props.onChoose).toHaveBeenCalledWith(parts, 'auth');
  });

  it('offers a field for an answer of the person own only where the question takes one', () => {
    const props = renderCard();

    const fields = screen.getAllByRole('textbox');
    expect(fields).toHaveLength(1);
    fireEvent.change(fields[0] as HTMLElement, { target: { value: 'Teal' } });
    fireEvent.keyDown(fields[0] as HTMLElement, { key: 'Enter', metaKey: true });

    expect(props.onType).toHaveBeenCalledWith(colour, 'Teal');
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('holds the send back, saying why, until every question has an answer', () => {
    const props = renderCard({ problem: 'No answer to "Which parts should it cover?".' });

    const send = screen.getByRole('button', { name: 'Send answer' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(send.getAttribute('title')).toBe('No answer to "Which parts should it cover?".');
    fireEvent.click(send);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('sends when the answer fits, and says what went wrong when it did not go through', () => {
    const props = renderCard({ error: 'This question is no longer open.' });

    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    expect(props.onSubmit).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('This question is no longer open.');
  });
});
