import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { Composer } from './Composer';
import type { AgentSession } from './agent-picker/useAgentSession';
import type { SessionInfo } from './agent-picker/types';

const info = {
  activeProvider: 'p',
  activeMode: 'default',
  skills: [
    { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser'], description: 'Drive the in-window browser' },
    { id: 'plugin/computer-control', name: 'computer-control', label: 'Computer Use', aliases: ['computer_use'], description: 'Operate desktop apps' },
  ],
} as unknown as SessionInfo;

const agent: AgentSession = { info, selectedModel: null, modes: [], onMode: () => {}, onPickProviderModel: async () => {} };

beforeEach(() => {
  __setApiOverride({ invoke: async () => undefined, subscribe: () => () => {} } as never);
});

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

function renderComposer(onSend = vi.fn()) {
  render(
    <Composer
      agent={agent}
      ready
      sending={false}
      compacting={false}
      activeTurnId={null}
      workspaceId="w-mentions"
      onOpenVoiceCall={() => {}}
      onSend={onSend}
      onAbort={() => {}}
    />,
  );
  return { input: screen.getByTestId('composer-input') as HTMLTextAreaElement, onSend };
}

const type = (input: HTMLTextAreaElement, value: string) =>
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });

describe('Composer @ menu', () => {
  it('offers Computer Use and the Moxxy Browser after @, and Enter puts the pick in instead of sending', () => {
    const { input, onSend } = renderComposer();

    type(input, 'zrób baner @com');
    const menu = screen.getByRole('listbox', { name: 'Mention a tool' });
    expect(menu.textContent).toContain('Computer Use');
    expect(menu.textContent).not.toContain('Moxxy Browser');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('zrób baner @computer_use ');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Mention a tool' })).toBeNull();
  });

  it('moves with the arrows, picks with a click, and Escape closes it without clearing the draft', () => {
    const { input } = renderComposer();

    type(input, '@');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Moxxy Browser');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('@');

    type(input, '@ i @m');
    fireEvent.mouseDown(screen.getByRole('option', { name: /Moxxy Browser/u }));
    expect(input.value).toBe('@ i @moxxy_browser ');
  });
});
