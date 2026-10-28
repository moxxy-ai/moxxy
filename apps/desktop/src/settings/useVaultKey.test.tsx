import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useVaultKey } from './useVaultKey';

describe('useVaultKey', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let entries: Array<{ name: string }>;

  beforeEach(() => {
    entries = [];
    invoke = vi.fn(async (command: string) => {
      if (command === 'settings.vaultEntries') return entries;
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  });

  afterEach(() => __setApiOverride(null));

  it('reports whether the named key is saved, without reading its value', async () => {
    entries = [{ name: 'OPENAI_API_KEY' }];
    const { result } = renderHook(() => useVaultKey('OPENAI_API_KEY'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasKey).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith('settings.vaultGet', expect.anything());
  });

  it('saves the trimmed draft under its name and clears the draft', async () => {
    const { result } = renderHook(() => useVaultKey('OPENAI_API_KEY'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasKey).toBe(false);

    act(() => result.current.setDraft('  sk-test  '));
    await act(async () => { await result.current.save(); });

    expect(invoke).toHaveBeenCalledWith('settings.vaultSet', { name: 'OPENAI_API_KEY', value: 'sk-test' });
    expect(result.current.hasKey).toBe(true);
    expect(result.current.draft).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('refuses an empty draft and writes nothing', async () => {
    const { result } = renderHook(() => useVaultKey('OPENAI_API_KEY'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft('   '));
    await act(async () => { await result.current.save(); });

    expect(invoke).not.toHaveBeenCalledWith('settings.vaultSet', expect.anything());
    expect(result.current.error).toMatch(/paste/i);
  });

  it('shows the vault error and keeps the draft when saving fails', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'settings.vaultEntries') return [];
      if (command === 'settings.vaultSet') throw new Error('vault is locked');
      return undefined;
    });
    const { result } = renderHook(() => useVaultKey('OPENAI_API_KEY'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft('sk-test'));
    await act(async () => { await result.current.save(); });

    expect(result.current.error).toBe('vault is locked');
    expect(result.current.hasKey).toBe(false);
    expect(result.current.draft).toBe('sk-test');
  });
});
