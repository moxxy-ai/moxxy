import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useChannels } from './useChannels.js';
import type { ChannelEntry, ChannelRuntimeStatus, MoxxyApi } from '@moxxy/desktop-ipc-contract';

afterEach(() => __setApiOverride(null));

const discord = (status: Partial<ChannelRuntimeStatus> = {}): ChannelEntry => ({
  descriptor: {
    id: 'discord',
    name: 'Discord',
    description: 'bot',
    configFields: [],
    hasWebhookUrl: false,
    supportsModel: true,
  },
  status: { id: 'discord', configured: true, running: false, ...status },
});

/** Fake IPC transport: the renderer ↔ main process boundary. */
function fakeApi(initial: ChannelEntry) {
  let push: ((status: ChannelRuntimeStatus) => void) | null = null;
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === 'channels.list') return [initial];
    if (cmd === 'channels.setRunMode') {
      const { mode } = args as { mode: 'manual' | 'app' | 'background' };
      return {
        ...initial.status,
        runMode: mode,
        ...(mode === 'background' ? { background: { installed: true, running: true } } : {}),
      };
    }
    if (cmd === 'channels.setModel') {
      const { model } = args as { model: string | null };
      return { ...initial.status, ...(model ? { model } : { model: undefined }) };
    }
    throw new Error(`unexpected ${cmd}`);
  });
  const api: MoxxyApi = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((event: string, fn: (status: ChannelRuntimeStatus) => void) => {
      if (event === 'channels.status') push = fn;
      return () => {};
    }) as unknown as MoxxyApi['subscribe'],
  };
  return { api, invoke, push: (s: ChannelRuntimeStatus) => push?.(s) };
}

async function mounted(initial: ChannelEntry) {
  const fake = fakeApi(initial);
  __setApiOverride(fake.api);
  const hook = renderHook(() => useChannels());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...fake, hook };
}

const modelOf = (list: ReadonlyArray<ChannelEntry>) => list[0]?.status.model;

describe('useChannels — channel model', () => {
  it('setModel stores the choice and shows it', async () => {
    const { hook, invoke } = await mounted(discord());

    await act(async () => {
      await hook.result.current.setModel('discord', 'openai-codex::gpt-5.6-luna');
    });

    expect(invoke).toHaveBeenCalledWith('channels.setModel', {
      channelId: 'discord',
      model: 'openai-codex::gpt-5.6-luna',
    });
    expect(modelOf(hook.result.current.list)).toBe('openai-codex::gpt-5.6-luna');
  });

  it('setModel(null) resets to the default model', async () => {
    const { hook } = await mounted(discord({ model: 'openai-codex::gpt-5.6-luna' }));

    await act(async () => {
      await hook.result.current.setModel('discord', null);
    });

    expect(modelOf(hook.result.current.list)).toBeUndefined();
  });

  it('keeps the known model when a runtime-only status push (start/stop/crash) arrives', async () => {
    const { hook, push } = await mounted(discord({ model: 'openai-codex::gpt-5.6-luna' }));

    act(() => push({ id: 'discord', configured: true, running: true, pid: 42 }));

    expect(hook.result.current.list[0]?.status.running).toBe(true);
    expect(modelOf(hook.result.current.list)).toBe('openai-codex::gpt-5.6-luna');
  });
});

describe('useChannels — run mode', () => {
  it('setRunMode applies the reported mode and background state', async () => {
    const { hook, invoke } = await mounted(discord({ runMode: 'manual' }));

    await act(async () => {
      await hook.result.current.setRunMode('discord', 'background');
    });

    expect(invoke).toHaveBeenCalledWith('channels.setRunMode', { channelId: 'discord', mode: 'background' });
    expect(hook.result.current.list[0]?.status.runMode).toBe('background');
    expect(hook.result.current.list[0]?.status.background).toEqual({ installed: true, running: true });
  });

  it('a runtime-only push keeps the known run mode', async () => {
    const { hook, push } = await mounted(discord({ runMode: 'app' }));

    act(() => push({ id: 'discord', configured: true, running: true }));

    expect(hook.result.current.list[0]?.status.runMode).toBe('app');
  });
});
