import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { ChannelEntry } from '@moxxy/desktop-ipc-contract';
import { useSidebarChannels } from './useSidebarChannels';

const entry = (id: string, name: string, configured: boolean, running = false): ChannelEntry => ({
  descriptor: { id, name, description: '', configFields: [], hasWebhookUrl: false },
  status: { id, configured, running },
});

beforeEach(() => {
  // Fake IPC transport — the renderer ↔ main boundary.
  __setApiOverride({
    invoke: vi.fn(async (cmd: string) => {
      if (cmd === 'channels.list') {
        return [entry('slack', 'Slack', false), entry('discord', 'Discord', true, true), entry('telegram', 'Telegram', true)];
      }
      throw new Error(`unexpected ${cmd}`);
    }),
    subscribe: () => () => {},
  } as never);
});

afterEach(() => __setApiOverride(null));

describe('useSidebarChannels', () => {
  it('lists only the channels you set up, with their live state', async () => {
    const { result } = renderHook(() => useSidebarChannels());

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.items).toEqual([
      { id: 'discord', name: 'Discord', state: 'running' },
      { id: 'telegram', name: 'Telegram', state: 'done' },
    ]);
  });

  it('is expanded by default and can be folded', async () => {
    const { result } = renderHook(() => useSidebarChannels());
    expect(result.current.expanded).toBe(true);

    act(() => result.current.toggle());

    expect(result.current.expanded).toBe(false);
  });
});
