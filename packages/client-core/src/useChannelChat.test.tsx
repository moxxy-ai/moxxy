import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { useChannelChat } from './useChannelChat.js';

afterEach(() => __setApiOverride(null));

/** Fake IPC transport — the renderer ↔ main boundary. */
function installApi(invoke: (cmd: string, args?: unknown) => Promise<unknown>) {
  const spy = vi.fn(invoke);
  __setApiOverride({
    invoke: spy as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => undefined) as unknown as MoxxyApi['subscribe'],
  });
  return spy;
}

describe('useChannelChat', () => {
  it("opens the bot's conversation as a chat and hands back its chat id", async () => {
    const invoke = installApi(async () => ({ workspaceId: 'moxxy-channel-discord' }));

    const { result } = renderHook(() => useChannelChat('discord'));

    await waitFor(() => expect(result.current.workspaceId).toBe('moxxy-channel-discord'));
    expect(invoke).toHaveBeenCalledWith('channels.openChat', { channelId: 'discord' });
    expect(result.current.error).toBeNull();
  });

  it('reports why the chat could not be opened', async () => {
    installApi(async () => {
      throw new Error('unknown channel: nope');
    });

    const { result } = renderHook(() => useChannelChat('nope'));

    await waitFor(() => expect(result.current.error).toMatch(/unknown channel/u));
    expect(result.current.workspaceId).toBeNull();
  });
});
