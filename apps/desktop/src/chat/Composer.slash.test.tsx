import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import { Composer } from './Composer';
import type { AgentSession } from './agent-picker/useAgentSession';
import type { SessionInfo } from './agent-picker/types';

/**
 * A slash in the empty field opens the run's switches where the hands already
 * are: the modes, the skills and the actions, picked without the "+" menu.
 */

const WORKSPACE = 'w-slash';
const info = {
  activeProvider: 'p',
  activeMode: 'default',
  skills: [
    { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser'], description: 'Drive the in-window browser' },
  ],
  commands: [
    { name: 'compact', description: 'Summarize older turns' },
    { name: 'vault', description: 'Store a secret' },
  ],
} as unknown as SessionInfo;

/** Every call across the IPC boundary, the one thing replaced: there is no Electron main here. */
let calls: Array<[string, unknown]>;

beforeEach(() => {
  calls = [];
  __setApiOverride({
    invoke: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return name === 'session.runCommand' ? { kind: 'noop' } : undefined;
    },
    subscribe: () => () => {},
  } as never);
});

afterEach(() => {
  cleanup();
  act(() => chatStore.setAutoApprove(WORKSPACE, false));
  __setApiOverride(null);
});

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onMode = vi.fn();
  const onSend = vi.fn();
  const agent: AgentSession = {
    info,
    selectedModel: null,
    modes: ['default', 'plan', 'goal', 'research'],
    onMode,
    onPickProviderModel: async () => {},
  };
  render(
    <Composer
      agent={agent}
      ready
      sending={false}
      compacting={false}
      activeTurnId={null}
      workspaceId={WORKSPACE}
      onOpenVoiceCall={() => {}}
      onSend={onSend}
      onAbort={() => {}}
      {...props}
    />,
  );
  return { input: screen.getByTestId('composer-input') as HTMLTextAreaElement, onMode, onSend };
}

const type = (input: HTMLTextAreaElement, value: string) =>
  fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } });
const enter = (input: HTMLTextAreaElement) => fireEvent.keyDown(input, { key: 'Enter' });
const menu = () => screen.queryByRole('listbox', { name: 'Modes, skills and actions' });
const sent = (name: string) => calls.filter(([call]) => call === name).map(([, args]) => args);

describe('Composer slash menu', () => {
  it('opens on a slash with the modes, the skills and the actions, each under its name', () => {
    const { input } = renderComposer();

    type(input, '/');

    const text = menu()?.textContent ?? '';
    for (const word of ['Modes', 'Plan', 'Research', 'Skills', 'Moxxy Browser', 'Actions', 'Compact', 'Auto-approve']) {
      expect(text).toContain(word);
    }
  });

  it('switches the mode on Enter, and takes the slash word out of the field instead of sending it', () => {
    const { input, onMode, onSend } = renderComposer();

    type(input, '/pl');
    enter(input);

    expect(onMode).toHaveBeenCalledWith('plan');
    expect(input.value).toBe('');
    expect(onSend).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('arms a goal, which waits for its objective in the same field', () => {
    const { input } = renderComposer();

    type(input, '/goal');
    enter(input);

    expect(screen.getByTestId('composer-goal-armed')).toBeTruthy();
    expect(input.value).toBe('');
  });

  it('puts a skill in as its mention, ready for the rest of the prompt', () => {
    const { input, onSend } = renderComposer();

    type(input, '/brow');
    fireEvent.mouseDown(screen.getByRole('option', { name: /Moxxy Browser/u }));

    expect(input.value).toBe('@moxxy_browser ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('runs an action of the run', async () => {
    const { input } = renderComposer();

    type(input, '/comp');
    enter(input);

    await waitFor(() => expect(sent('session.runCommand')).toEqual([{ workspaceId: WORKSPACE, name: 'compact', args: '' }]));
    expect(input.value).toBe('');
  });

  it('asks for what an action needs in its form, never in the prompt field', () => {
    const { input } = renderComposer();

    type(input, '/vault');
    enter(input);

    expect(screen.getByText('Vault key')).toBeTruthy();
    expect(sent('session.runCommand')).toEqual([]);
  });

  it('turns auto-approve on and says so above the field', () => {
    const { input } = renderComposer();

    type(input, '/auto');
    enter(input);

    expect(sent('session.setAutoApprove')).toEqual([{ workspaceId: WORKSPACE, enabled: true }]);
    expect(screen.getByTestId('composer-auto-approve')).toBeTruthy();
  });

  it('moves with the arrows, and Escape closes it without clearing the draft', () => {
    const { input } = renderComposer();

    type(input, '/');
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Default');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Plan');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(input.value).toBe('/');
  });

  it('will not change the mode under a running turn', () => {
    const { input, onMode } = renderComposer({ activeTurnId: 't1' });

    type(input, '/plan');
    expect(screen.getByRole('option', { name: /Plan/u }).getAttribute('aria-disabled')).toBe('true');
    enter(input);

    expect(onMode).not.toHaveBeenCalled();
    expect(input.value).toBe('/plan');
  });
});

describe('Composer slash line typed in full', () => {
  it('starts the prompt in the mode it names, once the mode is on', async () => {
    const { input, onSend } = renderComposer();

    type(input, '/plan move the list to SQLite');
    enter(input);

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('move the list to SQLite', undefined));
    expect(sent('session.setMode')).toEqual([{ workspaceId: WORKSPACE, mode: 'plan' }]);
    expect(input.value).toBe('');
  });

  it('starts a goal run from the objective after the word', async () => {
    const { input, onSend } = renderComposer();

    type(input, '/goal ship the redesign');
    enter(input);

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('ship the redesign', undefined));
    expect(sent('session.setMode')).toEqual([{ workspaceId: WORKSPACE, mode: 'goal' }]);
  });

  it('hands an action its words', async () => {
    const { input, onSend } = renderComposer();

    type(input, '/compact keep the plan');
    enter(input);

    await waitFor(() =>
      expect(sent('session.runCommand')).toEqual([{ workspaceId: WORKSPACE, name: 'compact', args: 'keep the plan' }]),
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a path, or any other line that only starts with a slash, as the prompt it is', () => {
    const { input, onSend } = renderComposer();

    type(input, '/Users/me/notes.md explain this');
    enter(input);

    expect(onSend).toHaveBeenCalledWith('/Users/me/notes.md explain this', undefined);
  });
});
