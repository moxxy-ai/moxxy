import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import { AskSheet } from './AskSheet';

/**
 * What a blocking question looks like. It is part of the conversation, so it
 * is drawn from the stylesheet like everything else in it, and what the agent
 * wrote is read as prose rather than as a terminal dump.
 */

afterEach(cleanup);

const researchGate: AskRequest = {
  requestId: 'r1',
  workspaceId: 'w1',
  kind: 'approval',
  approval: {
    title: 'Query plan ready — review before fan-out',
    body: '1. What does the SQLite documentation say?\n2. How do Electron apps ship it?',
    defaultOptionId: 'approve',
    options: [
      { id: 'approve', label: 'Approve and fan out' },
      { id: 'redraft', label: 'Redraft with feedback', requestsText: true },
      { id: 'cancel', label: 'Cancel this turn', danger: true },
    ],
  },
};

const permission: AskRequest = {
  requestId: 'r2',
  workspaceId: 'w1',
  kind: 'permission',
  tool: { name: 'Bash', input: { command: 'pnpm build' }, description: 'Run a shell command' },
};

describe('AskSheet look', () => {
  it('reads what the agent wrote as prose, not as a terminal dump', () => {
    render(<AskSheet ask={researchGate} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('.ask-dock__body li')).toHaveLength(2);
    expect(dialog.querySelector('pre')).toBeNull();
  });

  it('tones its answers from the stylesheet: one filled, the rest quiet, the destructive one red', () => {
    render(<AskSheet ask={researchGate} />);
    const tone = (name: string): string | undefined =>
      screen.getByRole('button', { name }).dataset.tone;
    expect(tone('Approve and fan out')).toBe('primary');
    expect(tone('Redraft with feedback')).toBe('neutral');
    expect(tone('Cancel this turn')).toBe('danger');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('ask-btn');
    }
    // The sheet paints nothing inline, so it follows the theme like the rest.
    // (What the agent wrote is the conversation's own markdown.)
    const dialog = screen.getByRole('dialog');
    const painted = [dialog, ...dialog.querySelectorAll('[style]')].filter(
      (el) => el.hasAttribute('style') && !el.closest('.ask-dock__body'),
    );
    expect(painted).toHaveLength(0);
  });

  it('says a tool is waiting in a sentence, and keeps its call in the monospace well', () => {
    render(<AskSheet ask={permission} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-tone', 'caution');
    expect(dialog.querySelector('.ask-dock__title')).toHaveTextContent('Bash needs your approval');
    // The thing you vouch for is not reflowed or restyled as prose.
    expect(dialog.querySelector('pre.ask-dock__cmd')).toHaveTextContent('pnpm build');
  });
});
