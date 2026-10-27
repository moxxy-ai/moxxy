import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { chatStore } from '@moxxy/client-core';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import { QUESTION_ASKED, QUESTION_PLUGIN_ID, type MoxxyEvent } from '@moxxy/sdk';
import { AskSheet } from '@/chat/AskSheet';
import { useAskPrompt } from '@/chat/ask/ask-prompt';
import { FocusAskCard } from './FocusAskCard';
import { useFocusAsk } from './useFocusAsk';

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
  return prompt ? <FocusAskCard ask={{ kind: 'approval', prompt }} variant={variant} /> : null;
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
      ['Allow for session', 'neutral'],
      ['Always allow', 'neutral'],
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

  it('shows a Question from the agent too, picked and sent from the small card', () => {
    act(() => chatStore.dispatch('w-q', { type: 'send_started', turnId: 't1' }));
    const asked = {
      id: 'ev-q', seq: 1, ts: 0, sessionId: 's', turnId: 't1', type: 'plugin_event', source: 'system',
      pluginId: QUESTION_PLUGIN_ID, subtype: QUESTION_ASKED,
      payload: {
        questionId: 'q-focus',
        questions: [
          {
            id: 'q1',
            question: 'Which colour?',
            options: [{ id: 'red', label: 'Red' }, { id: 'blue', label: 'Blue' }],
            multiSelect: false,
            allowOther: true,
          },
        ],
      },
    } as unknown as MoxxyEvent;
    act(() => chatStore.dispatch('w-q', { type: 'event', event: asked }));
    function Asked({ variant }: { readonly variant: 'toast' | 'panel' }): JSX.Element | null {
      const ask = useFocusAsk('w-q');
      return ask ? <FocusAskCard ask={ask} variant={variant} /> : null;
    }

    const { unmount } = render(<Asked variant="toast" />);
    const card = screen.getByRole('group', { name: 'Question from the agent' });
    expect(card).toHaveClass('ask-dock', 'ask-dock--toast');
    expect(card).not.toHaveAttribute('aria-modal');
    expect(within(card).getByText('Which colour?')).toBeInTheDocument();
    const blue = within(card).getByRole('button', { name: 'Blue' });
    fireEvent.click(blue);
    expect(blue).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByRole('button', { name: 'Send answer' })).toBeEnabled();
    // The toast has a fixed frame: the questions scroll inside it, Send stays in view below them.
    const list = card.querySelector('.question__list');
    expect(list?.querySelectorAll('fieldset')).toHaveLength(1);
    expect(list?.contains(within(card).getByRole('button', { name: 'Send answer' }))).toBe(false);
    unmount();

    render(<Asked variant="panel" />);
    expect(screen.getByRole('group', { name: 'Question from the agent' })).toHaveClass('ask-dock--panel');
  });
});
