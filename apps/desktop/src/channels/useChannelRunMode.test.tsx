import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelRunMode } from '@moxxy/desktop-ipc-contract';
import { useChannelRunMode } from './useChannelRunMode';
import { useChannelPage } from '../apps/ChannelsPanel';

function setup(
  runMode: ChannelRunMode | undefined,
  background?: { installed: boolean; running: boolean },
  setRunMode = vi.fn(async () => undefined),
) {
  const hook = renderHook(() => useChannelRunMode({ channelId: 'discord', runMode, background, setRunMode }));
  return { hook, setRunMode };
}

describe('useChannelRunMode', () => {
  it('offers manual / with the app / always in the background, defaulting to manual', () => {
    const { hook } = setup(undefined);
    expect(hook.result.current.options.map((o) => o.mode)).toEqual(['manual', 'app', 'background']);
    expect(hook.result.current.current).toBe('manual');
    expect(hook.result.current.options.every((o) => o.label && o.hint)).toBe(true);
  });

  it('choosing a mode asks the host to switch', async () => {
    const { hook, setRunMode } = setup('manual');

    await act(async () => hook.result.current.choose('background'));

    expect(setRunMode).toHaveBeenCalledWith('discord', 'background');
    expect(hook.result.current.busy).toBe(false);
  });

  it('choosing the current mode does nothing', async () => {
    const { hook, setRunMode } = setup('app');
    await act(async () => hook.result.current.choose('app'));
    expect(setRunMode).not.toHaveBeenCalled();
  });

  it('shows why a switch failed', async () => {
    const { hook } = setup('manual', undefined, vi.fn(async () => {
      throw new Error('launchctl bootstrap failed');
    }));

    await act(async () => hook.result.current.choose('background'));

    expect(hook.result.current.error).toMatch(/launchctl/);
  });

  it('describes the background service state', () => {
    expect(setup('manual').hook.result.current.serviceLabel).toBeNull();
    expect(setup('background', { installed: true, running: true }).hook.result.current.serviceLabel).toMatch(
      /running in the background/i,
    );
    expect(setup('background', { installed: true, running: false }).hook.result.current.serviceLabel).toMatch(
      /not running/i,
    );
  });
});

describe('useChannelPage — background service owns the bot', () => {
  it('blocks Start/Stop while the channel runs as a background service', () => {
    const entry = (runMode: ChannelRunMode) => ({
      descriptor: { id: 'discord', name: 'Discord', description: '', configFields: [], hasWebhookUrl: false },
      status: { id: 'discord', configured: true, running: false, runMode },
    });
    const handlers = { saveConfig: vi.fn(), start: vi.fn(), stop: vi.fn() };

    expect(renderHook(() => useChannelPage(entry('background'), handlers)).result.current.runsInBackground).toBe(true);
    expect(renderHook(() => useChannelPage(entry('app'), handlers)).result.current.runsInBackground).toBe(false);
  });
});
