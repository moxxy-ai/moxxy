import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolResultEvent } from '@moxxy/sdk';
import { ToolBlock } from './ToolBlock';

/**
 * Once the person answers a Question, its card goes away; the transcript keeps
 * what they chose, so scrolling back shows the question and the answer.
 */

afterEach(cleanup);

const outcome = {
  type: 'tool_result',
  id: 'e2',
  seq: 2,
  ts: 0,
  sessionId: 's',
  turnId: 't1',
  callId: 'c1',
  ok: true,
  output: {
    forModel: 'The user answered: …',
    display: {
      kind: 'question-answer',
      questions: [
        { header: 'Colour', question: 'Which colour should the button be?', chosen: ['Blue'] },
        { question: 'Which parts should it cover?', chosen: ['Auth', 'Billing'], own: 'and the admin page' },
      ],
    },
  },
} as unknown as ToolResultEvent;

describe('an answered Question in the transcript', () => {
  it('shows each question with what the person chose, not the raw tool result', () => {
    render(<ToolBlock name="ask_user" input={{}} outcome={outcome} />);

    const block = screen.getByRole('group', { name: 'You answered' });
    expect(within(block).getByText('Colour')).toBeInTheDocument();
    expect(within(block).getByText('Which colour should the button be?')).toBeInTheDocument();
    expect(within(block).getByText('Blue')).toBeInTheDocument();
    expect(within(block).getByText('Auth, Billing')).toBeInTheDocument();
    expect(within(block).getByText('“and the admin page”')).toBeInTheDocument();
    expect(screen.queryByText(/The user answered/)).toBeNull();
  });
});
