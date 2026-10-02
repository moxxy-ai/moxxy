import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useJevSettings } from './useJevSettings';

// Desktop IPC to the main process is the one boundary stood in here: a vault in memory.
function installVault(initial: ReadonlyArray<string> = []) {
  const names = new Set(initial);
  const invoke = vi.fn(async (command: string, args?: { name: string; value?: string }) => {
    if (command === 'settings.vaultEntries') return [...names].map((name) => ({ name }));
    if (command === 'settings.vaultSet' && args) names.add(args.name);
    if (command === 'settings.vaultDelete' && args) names.delete(args.name);
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return { invoke, names };
}

afterEach(() => __setApiOverride(null));

describe('useJevSettings', () => {
  it('reports no key and Jev off on a fresh vault', async () => {
    installVault();
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ hasKey: false, enabled: false, editing: true });
  });

  it('saves the key under the name the Computer Use plugin reads, and never keeps the value', async () => {
    const { invoke } = installVault();
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setKeyDraft('  secret-key  '));
    await act(async () => result.current.saveKey());

    expect(invoke).toHaveBeenCalledWith('settings.vaultSet', { name: 'TYPESAFE_API_KEY', value: 'secret-key' });
    expect(result.current).toMatchObject({ hasKey: true, enabled: true, editing: false, keyDraft: '' });
  });

  it('switches Jev off and on again while the key stays stored', async () => {
    const { names } = installVault(['TYPESAFE_API_KEY']);
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ hasKey: true, enabled: true, editing: false });

    await act(async () => result.current.setEnabled(false));
    expect([...names].sort()).toEqual(['JEV_DISABLED', 'TYPESAFE_API_KEY']);
    expect(result.current.enabled).toBe(false);

    await act(async () => result.current.setEnabled(true));
    expect([...names]).toEqual(['TYPESAFE_API_KEY']);
    expect(result.current.enabled).toBe(true);
  });

  it('reads a switch that another surface turned off', async () => {
    installVault(['TYPESAFE_API_KEY', 'JEV_DISABLED']);
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ hasKey: true, enabled: false });
  });

  it('opens the key field to change a stored key, and closes it without saving', async () => {
    const { invoke } = installVault(['TYPESAFE_API_KEY']);
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.changeKey());
    expect(result.current.editing).toBe(true);
    act(() => result.current.setKeyDraft('half typed'));
    act(() => result.current.cancelChange());
    expect(result.current).toMatchObject({ editing: false, keyDraft: '' });
    expect(invoke).not.toHaveBeenCalledWith('settings.vaultSet', expect.anything());
  });

  it('shows why a save failed and keeps the draft', async () => {
    const { invoke } = installVault();
    const { result } = renderHook(() => useJevSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    invoke.mockImplementationOnce(async () => { throw new Error('vault is locked'); });

    act(() => result.current.setKeyDraft('secret-key'));
    await act(async () => result.current.saveKey());

    expect(result.current).toMatchObject({ error: 'vault is locked', hasKey: false, keyDraft: 'secret-key' });
  });
});
