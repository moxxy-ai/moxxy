import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import { Composer } from './Composer';
import type { AgentSession } from './agent-picker/useAgentSession';
import type { SessionInfo } from './agent-picker/types';

/**
 * The composer is one card: a round add button, the field, and a round button
 * that sends. What the next turn will do is said only when it is not the
 * default, and the keyboard hints are gone from under it.
 */

const WORKSPACE = 'w-layout';
const info = { activeProvider: 'p', activeMode: 'default', skills: [] } as unknown as SessionInfo;
const agent: AgentSession = {
  info,
  selectedModel: 'gpt-6-luna',
  modes: ['default', 'plan'],
  onMode: () => {},
  onPickProviderModel: async () => {},
};

beforeEach(() => {
  // The IPC boundary is the one thing replaced: there is no Electron main here.
  __setApiOverride({ invoke: async () => undefined, subscribe: () => () => {} } as never);
});

afterEach(() => {
  cleanup();
  act(() => chatStore.setAutoApprove(WORKSPACE, false));
  __setApiOverride(null);
});

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onOpenVoiceCall = vi.fn();
  const onSend = vi.fn();
  const view = render(
    <Composer
      agent={agent}
      ready
      sending={false}
      compacting={false}
      activeTurnId={null}
      workspaceId={WORKSPACE}
      onOpenVoiceCall={onOpenVoiceCall}
      onSend={onSend}
      onAbort={() => {}}
      {...props}
    />,
  );
  const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
  return { ...view, input, onOpenVoiceCall, onSend };
}

const openTools = () => fireEvent.click(screen.getByRole('button', { name: 'More tools' }));

describe('Composer layout', () => {
  it('is one card with no status strip and no line of keyboard hints', () => {
    const { container } = renderComposer();
    expect(container.querySelector('.cmdbar__card')).not.toBeNull();
    expect(container.querySelector('.cmdbar__strip')).toBeNull();
    expect(container.querySelector('.cmdbar__keys')).toBeNull();
    expect(screen.queryByText(/Enter sends/)).toBeNull();
    expect(screen.queryByText(/commands/)).toBeNull();
    // The model and the mode are read in the header, not repeated here.
    expect(screen.queryByText('gpt-6-luna')).toBeNull();
    expect(screen.queryByText('default')).toBeNull();
  });

  it('sends from a round icon button that is named for what it does', () => {
    const { input, onSend } = renderComposer();
    const send = screen.getByTestId('composer-send');
    expect(send).toHaveAccessibleName('Send');
    expect(send.textContent).toBe('');
    expect(send).toBeDisabled();
    expect(send).not.toHaveAttribute('style');

    fireEvent.change(input, { target: { value: 'ship it' } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith('ship it', undefined);
  });

  it('offers Stop while a turn runs, and says a new message will queue', () => {
    const { input } = renderComposer({ activeTurnId: 't1' });
    const stop = screen.getByTestId('composer-abort');
    expect(stop).toHaveAccessibleName('Stop');
    expect(stop.textContent).toBe('');
    expect(screen.queryByTestId('composer-send')).toBeNull();
    expect(input.placeholder).toBe('Queue a follow-up…');
  });

  it('says when tool calls will run unreviewed, and only then', () => {
    renderComposer();
    expect(screen.queryByTestId('composer-auto-approve')).toBeNull();
    act(() => chatStore.setAutoApprove(WORKSPACE, true));
    expect(screen.getByTestId('composer-auto-approve').textContent).toBe('Auto-approve on');
  });

  it('arms a goal from the + menu and stands it down from its chip', () => {
    renderComposer();
    openTools();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Set a goal' }));
    expect(screen.getByTestId('composer-send')).toHaveAccessibleName('Start goal');

    fireEvent.click(screen.getByTestId('composer-goal-armed'));
    expect(screen.queryByTestId('composer-goal-armed')).toBeNull();
    expect(screen.getByTestId('composer-send')).toHaveAccessibleName('Send');
  });

  it('starts a voice conversation from the + menu, not from a button of its own', () => {
    const { onOpenVoiceCall } = renderComposer();
    expect(screen.queryByRole('button', { name: 'Open Voice Mode' })).toBeNull();
    openTools();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Voice conversation' }));
    expect(onOpenVoiceCall).toHaveBeenCalledTimes(1);
  });

  it('drops the voice conversation entry while one is already open', () => {
    renderComposer({ voiceModeActive: true });
    openTools();
    expect(screen.queryByRole('menuitem', { name: 'Voice conversation' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voice input' })).toBeNull();
  });

  it('keeps dictation one press away', () => {
    renderComposer();
    expect(screen.getByRole('button', { name: 'Voice input' })).toBeInTheDocument();
  });
});

describe('Composer in a mode', () => {
  const inMode = (activeMode: string): AgentSession => ({
    ...agent,
    info: { ...info, activeMode } as SessionInfo,
    modes: ['default', 'plan', 'goal', 'research'],
  });

  it('says nothing about the default mode', () => {
    renderComposer();
    expect(screen.queryByTestId('composer-mode')).toBeNull();
    expect(screen.getByTestId('composer-input')).toHaveAttribute('placeholder', 'Message Moxxy…');
  });

  it('says which mode the next turn runs in, the same way for every mode', () => {
    const { rerender } = render(<div />);
    for (const [mode, text] of [
      ['plan', 'Plan mode · read-only'],
      ['goal', 'Goal mode · unattended'],
      ['research', 'Research mode'],
    ] as const) {
      rerender(
        <Composer
          agent={inMode(mode)}
          ready
          sending={false}
          compacting={false}
          activeTurnId={null}
          workspaceId={WORKSPACE}
          onOpenVoiceCall={() => {}}
          onSend={() => {}}
          onAbort={() => {}}
        />,
      );
      expect(screen.getByTestId('composer-mode')).toHaveTextContent(text);
    }
    // One way of saying it: the wide banner goal mode used to get is gone.
    expect(screen.queryByTestId('mode-banner')).toBeNull();
  });

  it('asks in the field for what the mode works on', () => {
    renderComposer({ agent: inMode('plan') });
    expect(screen.getByTestId('composer-input')).toHaveAttribute('placeholder', 'Describe what to plan…');
  });

  it('goes back to the default mode from the chip', () => {
    const onMode = vi.fn();
    renderComposer({ agent: { ...inMode('research'), onMode } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Default mode' }));
    expect(onMode).toHaveBeenCalledWith('default');
  });

  it('lists the modes by name, each with what it does', () => {
    renderComposer({ agent: inMode('plan') });
    openTools();
    fireEvent.click(screen.getByRole('menuitem', { name: /Mode/ }));
    const plan = screen.getByRole('menuitemradio', { name: /Plan/ });
    expect(plan).toHaveAttribute('aria-checked', 'true');
    expect(plan).toHaveTextContent('Reads only, then writes a plan');
    expect(screen.getByRole('menuitemradio', { name: /Goal/ })).toHaveTextContent('Works unattended until it is done');
    // The raw id is not what anyone reads.
    expect(screen.queryByRole('menuitemradio', { name: 'plan' })).toBeNull();
  });
});
