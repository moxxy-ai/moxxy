import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import '../../apps/builtins';
import { ShellNavProvider, type ShellNav } from './ShellNav';
import { usePalettePlaces } from './usePalettePlaces';

/**
 * The main process behind IPC is stood in for (it owns the channel catalog);
 * the navigation is the shell's own object, with its functions recorded.
 */

function nav(over: Partial<ShellNav> = {}): ShellNav {
  return {
    view: 'chat',
    go: vi.fn(),
    open: vi.fn(),
    isDisabled: () => false,
    disabledReason: 'loading',
    showShortcuts: vi.fn(),
    openPalette: vi.fn(),
    ...over,
  };
}

const within = (value: ShellNav) =>
  function Shell({ children }: { readonly children: ReactNode }): JSX.Element {
    return <ShellNavProvider value={value}>{children}</ShellNavProvider>;
  };

beforeEach(() => {
  __setApiOverride({
    invoke: vi.fn(async (command: string) =>
      command === 'channels.list'
        ? [{ descriptor: { id: 'telegram', name: 'Telegram', description: '', configFields: [] }, status: { id: 'telegram', running: false } }]
        : null,
    ),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

describe('usePalettePlaces', () => {
  it('offers every place, each settings option, each channel and each app', async () => {
    const { result } = renderHook(() => usePalettePlaces(), { wrapper: within(nav()) });
    const labels = (): string[] => result.current.places.map((place) => place.label);

    expect(labels()).toEqual(expect.arrayContaining(['Runs', 'Providers', 'GPT-Live', 'Webhooks', 'Document anonymizer']));
    await waitFor(() => expect(labels()).toContain('Telegram'));
  });

  it('opens the place that was picked, section and all', () => {
    const shell = nav();
    const { result } = renderHook(() => usePalettePlaces(), { wrapper: within(shell) });
    const voice = result.current.places.find((place) => place.label === 'GPT-Live');

    expect(voice).toBeDefined();
    if (voice) result.current.onPlace?.(voice);

    expect(shell.open).toHaveBeenCalledWith({ destination: 'settings', section: 'voice' });
  });

  it('locks what is inside a view the session keeps out of reach', () => {
    const shell = nav({ isDisabled: (id) => id === 'automations' });
    const { result } = renderHook(() => usePalettePlaces(), { wrapper: within(shell) });
    const disabled = (label: string): boolean | undefined =>
      result.current.places.find((place) => place.label === label)?.disabled;

    expect(disabled('Webhooks')).toBe(true);
    expect(disabled('Automations')).toBe(true);
    expect(disabled('Providers')).toBe(false);
  });

  it('writes the shortcut beside the place it goes to', () => {
    const { result } = renderHook(() => usePalettePlaces(), { wrapper: within(nav()) });

    expect(result.current.places.find((place) => place.label === 'Settings')?.hint).toBeTruthy();
    expect(result.current.places.find((place) => place.label === 'Providers')?.hint).toBeUndefined();
  });

  it('offers nothing outside the shell', () => {
    const { result } = renderHook(() => usePalettePlaces());

    expect(result.current.places).toEqual([]);
    expect(result.current.onPlace).toBeUndefined();
  });
});
