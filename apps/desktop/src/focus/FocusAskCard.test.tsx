import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import { AskSheet } from '@/chat/AskSheet';
import { useAskPrompt } from '@/chat/ask/ask-prompt';
import { FocusAskCard } from './FocusAskCard';

/**
 * The focus window is the desktop continued, so the same question reads the
 * same in both: one title, the same answers in the same order, the same one
 * filled.
 */

afterEach(cleanup);

const ask: AskRequest = {
  requestId: 'r1',
  workspaceId: 'w1',
  kind: 'permission',
  tool: { name: 'Bash', input: { command: 'pnpm build' }, description: 'Run a shell command' },
};

function Focus({ variant }: { readonly variant: 'toast' | 'panel' }): JSX.Element | null {
  const prompt = useAskPrompt(ask);
  return prompt ? <FocusAskCard prompt={prompt} variant={variant} /> : null;
}

const read = (card: HTMLElement) => ({
  title: card.querySelector('.ask-dock__title')?.textContent,
  command: card.querySelector('.ask-dock__cmd')?.textContent,
  answers: within(card)
    .getAllByRole('button')
    .map((button) => [button.textContent, button.dataset.tone]),
});

describe('FocusAskCard', () => {
  it('asks the same question as the desktop, with the same answers', () => {
    const desktop = render(<AskSheet ask={ask} />);
    const inDesktop = read(screen.getByRole('dialog'));
    desktop.unmount();

    render(<Focus variant="panel" />);
    const card = screen.getByRole('group', { name: 'approval required · Bash' });
    expect(read(card)).toEqual(inDesktop);
    expect(inDesktop.answers).toEqual([
      ['Allow once', 'primary'],
      ['Always allow Bash', 'neutral'],
      ['Deny', 'danger'],
    ]);
  });

  it('is the desktop’s card in a smaller frame, drawn from the stylesheet', () => {
    render(<Focus variant="toast" />);
    const card = screen.getByRole('group', { name: 'approval required · Bash' });
    expect(card).toHaveClass('ask-dock', 'ask-dock--toast');
    expect(card).toHaveAttribute('data-tone', 'caution');
    expect(card.hasAttribute('style')).toBe(false);
    // It floats over other windows, so it never takes the keyboard for itself.
    expect(card).not.toHaveAttribute('aria-modal');
  });
});
