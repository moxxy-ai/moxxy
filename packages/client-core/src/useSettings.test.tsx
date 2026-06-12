/**
 * useSettings + useSessionInfoBridge tests — drive the IPC surface through
 * the fake api shim and assert (1) the settings slice re-fetches when the
 * session-info refresh signal fires on the platform EventBus, (2) the
 * provider actions hit the right IPC commands in the right order, and
 * (3) the bridge re-emits the runner's `session.info.changed` push as
 * SESSION_INFO_REFRESH_EVENT.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { SESSION_INFO_REFRESH_EVENT } from '@moxxy/desktop-ipc-contract';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { configurePlatform, type EventBus } from './platform.js';
import { useSettings } from './useSettings.js';
import { useSessionInfoBridge } from './useSessionInfoBridge.js';

/** In-memory EventBus (the real desktop one wraps window events). */
function fakeEventBus(): EventBus & { fire: (event: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    on(event, handler) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    },
    emit(event) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
    fire(event) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };
}

afterEach(() => {
  __setApiOverride(null);
  configurePlatform({});
});

describe('useSettings', () => {
  it('re-fetches when SESSION_INFO_REFRESH_EVENT fires on the EventBus', async () => {
    const bus = fakeEventBus();
    configurePlatform({ eventBus: bus });
    const counts = { providers: 0 };
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'settings.providers') {
        counts.providers += 1;
        return [];
      }
      return [];
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    renderHook(() => useSettings());
    await waitFor(() => expect(counts.providers).toBe(1));

    act(() => bus.fire(SESSION_INFO_REFRESH_EVENT));
    await waitFor(() => expect(counts.providers).toBe(2));
  });

  it('setProviderEnabled hits settings.providerSetEnabled then refreshes', async () => {
    const invokes: string[] = [];
    const invoke = vi.fn(async (cmd: string) => {
      invokes.push(cmd);
      return [];
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(invokes).toContain('settings.providers'));
    invokes.length = 0;

    await act(() => result.current.setProviderEnabled('zai', false));
    expect(invokes[0]).toBe('settings.providerSetEnabled');
    expect(invokes).toContain('settings.providers'); // refreshed after
  });

  it('setProviderKey saves to the vault, re-probes readiness, then refreshes', async () => {
    const invokes: Array<{ cmd: string; args: unknown }> = [];
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      invokes.push({ cmd, args });
      return [];
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(invokes.some((i) => i.cmd === 'settings.providers')).toBe(true));
    invokes.length = 0;

    await act(() => result.current.setProviderKey('ZAI_API_KEY', 'sk-test'));
    expect(invokes[0]).toEqual({
      cmd: 'settings.vaultSet',
      args: { name: 'ZAI_API_KEY', value: 'sk-test' },
    });
    expect(invokes[1]?.cmd).toBe('settings.providerRefreshReady');
  });

  it('surfaces the runner error when a toggle is refused (active provider)', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'settings.providerSetEnabled') {
        throw new Error('Cannot disable the active provider "fake"');
      }
      return [];
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const { result } = renderHook(() => useSettings());
    // Let the mount fetch settle first — its success path clears `error`.
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.setProviderEnabled('fake', false));
    await waitFor(() => expect(result.current.error).toMatch(/active provider/i));
  });
});

describe('useSessionInfoBridge', () => {
  it("re-emits the host's session.info.changed push as SESSION_INFO_REFRESH_EVENT", async () => {
    const bus = fakeEventBus();
    configurePlatform({ eventBus: bus });
    let push: (() => void) | null = null;
    const api = {
      invoke: vi.fn(async () => []),
      subscribe: (channel: string, handler: () => void) => {
        if (channel === 'session.info.changed') push = handler;
        return () => {
          push = null;
        };
      },
    };
    __setApiOverride(api as unknown as MoxxyApi);

    const heard = vi.fn();
    bus.on(SESSION_INFO_REFRESH_EVENT, heard);

    const { unmount } = renderHook(() => useSessionInfoBridge());
    await waitFor(() => expect(push).not.toBeNull());

    act(() => push!());
    expect(heard).toHaveBeenCalledTimes(1);

    // Unmount unsubscribes from the IPC channel.
    unmount();
    expect(push).toBeNull();
  });
});
