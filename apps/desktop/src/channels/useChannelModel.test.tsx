import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useChannelModel } from './useChannelModel';

const providers = [
  { name: 'openai-codex', models: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-5.6-terra' }] },
  { name: 'anthropic', models: [{ id: 'claude-sonnet-5-5' }] },
];

let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invoke = vi.fn(async (command: string) => {
    if (command === 'session.info') return { providers, activeProvider: 'openai-codex' };
    return undefined;
  });
  // Fake IPC transport — the renderer ↔ main boundary.
  __setApiOverride({ invoke, subscribe: () => () => {} } as never);
});

afterEach(() => __setApiOverride(null));

function setup(model?: string, setModel = vi.fn(async () => undefined)) {
  const hook = renderHook(() =>
    useChannelModel({ channelId: 'discord', model, workspaceId: 'ws-1', setModel }),
  );
  return { hook, setModel };
}

describe('useChannelModel', () => {
  it('labels the default and a chosen model', () => {
    expect(setup().hook.result.current.label).toBe('Default (same as the app)');
    expect(setup('openai-codex::gpt-5.6-luna').hook.result.current.label).toBe('openai-codex · gpt-5.6-luna');
    expect(setup('openai-codex::gpt-5.6-luna').hook.result.current.isDefault).toBe(false);
  });

  it('loads the provider catalog of the active workspace when the picker opens', async () => {
    const { hook } = setup('openai-codex::gpt-5.6-luna');

    act(() => hook.result.current.openPicker());

    await waitFor(() => expect(hook.result.current.providers).toEqual(providers));
    expect(invoke).toHaveBeenCalledWith('session.info', { workspaceId: 'ws-1' });
    expect(hook.result.current.activeProvider).toBe('openai-codex');
    expect(hook.result.current.activeModel).toBe('gpt-5.6-luna');
  });

  it('picking a model saves provider::model for the channel and closes the picker', async () => {
    const { hook, setModel } = setup();
    act(() => hook.result.current.openPicker());

    await act(async () => hook.result.current.pick('anthropic', 'claude-sonnet-5-5'));

    expect(setModel).toHaveBeenCalledWith('discord', 'anthropic::claude-sonnet-5-5');
    expect(hook.result.current.picking).toBe(false);
  });

  it('picking a provider without a model uses its first model', async () => {
    const { hook, setModel } = setup();
    act(() => hook.result.current.openPicker());
    await waitFor(() => expect(hook.result.current.providers).toHaveLength(2));

    await act(async () => hook.result.current.pick('openai-codex', null));

    expect(setModel).toHaveBeenCalledWith('discord', 'openai-codex::gpt-5.6-luna');
  });

  it('"use default" clears the channel model', async () => {
    const { hook, setModel } = setup('openai-codex::gpt-5.6-luna');

    await act(async () => hook.result.current.resetToDefault());

    expect(setModel).toHaveBeenCalledWith('discord', null);
  });

  it('keeps the picker open and shows the error when saving fails', async () => {
    const { hook } = setup(undefined, vi.fn(async () => {
      throw new Error('vault locked');
    }));
    act(() => hook.result.current.openPicker());

    await act(async () => hook.result.current.pick('anthropic', 'claude-sonnet-5-5'));

    expect(hook.result.current.error).toMatch(/vault locked/);
    expect(hook.result.current.picking).toBe(true);
  });
});
