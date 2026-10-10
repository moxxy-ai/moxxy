import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { ModelDefaultsChange, StoredModelDefaults } from '@moxxy/desktop-ipc-contract';
import { useModelDefaults } from './useModelDefaults';

const luna = { id: 'gpt-6-luna', supportsReasoning: true, supportsFast: true };
const plain = { id: 'gpt-plain' };
const sonnet = { id: 'claude-sonnet-5-5', supportsReasoning: true };
const info = {
  activeProvider: 'anthropic',
  readyProviders: ['anthropic', 'openai-codex'],
  providers: [
    { name: 'anthropic', models: [sonnet], enabled: true },
    { name: 'openai-codex', models: [plain, luna], enabled: true },
    { name: 'openai', models: [{ id: 'gpt-key' }], enabled: true },
  ],
};

// Desktop IPC to the main process is the one boundary stood in here: the config's defaults, kept in memory.
function installHost(stored: Partial<StoredModelDefaults> = {}, opts: { readonly info?: unknown; readonly fail?: boolean } = {}) {
  let defaults: StoredModelDefaults = { provider: null, model: null, effort: 'off', fast: false, ...stored };
  const invoke = vi.fn(async (command: string, args?: ModelDefaultsChange) => {
    if (command === 'settings.modelDefaults') return defaults;
    if (command === 'session.info') return 'info' in opts ? opts.info : info;
    if (command === 'settings.setModelDefaults' && args) {
      if (opts.fail) throw new Error('config is read-only');
      defaults = {
        ...defaults,
        ...(args.model ? args.model : {}),
        ...(args.effort !== undefined ? { effort: args.effort } : {}),
        ...(args.fast !== undefined ? { fast: args.fast } : {}),
      };
    }
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return { invoke, stored: () => defaults };
}

async function loaded(...args: Parameters<typeof installHost>) {
  const host = installHost(...args);
  const view = renderHook(() => useModelDefaults());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return { ...host, ...view };
}

beforeEach(() => localStorage.clear());
afterEach(() => __setApiOverride(null));

describe('useModelDefaults', () => {
  it('shows what a new conversation runs on before anything is set: the active provider and its first model', async () => {
    const { result } = await loaded();

    expect(result.current).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'off', fast: false });
  });

  it('offers the models of the providers that are connected', async () => {
    const { result } = await loaded();

    expect(result.current.providers).toEqual([
      { name: 'anthropic', models: ['claude-sonnet-5-5'] },
      { name: 'openai-codex', models: ['gpt-plain', 'gpt-6-luna'] },
    ]);
  });

  it('shows the set default, and offers a model the provider does not list (a custom one)', async () => {
    const { result } = await loaded({ provider: 'openai-codex', model: 'my-own-model', effort: 'medium', fast: true });

    expect(result.current).toMatchObject({ provider: 'openai-codex', model: 'my-own-model', effort: 'medium', fast: true });
    expect(result.current.providers[1]).toEqual({ name: 'openai-codex', models: ['my-own-model', 'gpt-plain', 'gpt-6-luna'] });
  });

  it('saves a picked model with its provider and nothing else', async () => {
    const { result, invoke, stored } = await loaded({ effort: 'default', fast: true });

    await act(() => result.current.setModel('openai-codex', 'gpt-6-luna'));

    expect(invoke).toHaveBeenCalledWith('settings.setModelDefaults', { model: { provider: 'openai-codex', model: 'gpt-6-luna' } });
    expect(stored()).toEqual({ provider: 'openai-codex', model: 'gpt-6-luna', effort: 'default', fast: true });
    expect(result.current).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-luna', effort: 'default', fast: true });
  });

  it('saves the effort and the fast tier each on its own', async () => {
    const { result, invoke } = await loaded({ provider: 'openai-codex', model: 'gpt-6-luna' });

    await act(() => result.current.setEffort('medium'));
    await act(() => result.current.setFast(true));

    expect(invoke).toHaveBeenCalledWith('settings.setModelDefaults', { effort: 'medium' });
    expect(invoke).toHaveBeenCalledWith('settings.setModelDefaults', { fast: true });
    expect(result.current).toMatchObject({ effort: 'medium', fast: true });
  });

  it('offers the effort and the fast tier only for a model that has them', async () => {
    const { result } = await loaded({ provider: 'openai-codex', model: 'gpt-6-luna' });
    expect(result.current).toMatchObject({ canSetEffort: true, canSetFast: true });

    await act(() => result.current.setModel('openai-codex', 'gpt-plain'));
    expect(result.current).toMatchObject({ canSetEffort: false, canSetFast: false });

    await act(() => result.current.setModel('anthropic', 'claude-sonnet-5-5'));
    expect(result.current).toMatchObject({ canSetEffort: true, canSetFast: false });
  });

  it("shows reasoning that is on at the provider's own effort as Default, a level that cannot be picked", async () => {
    const { result, invoke } = await loaded({ provider: 'openai-codex', model: 'gpt-6-luna', effort: 'default' });

    expect(result.current.effortLevels).toEqual(['off', 'default', 'low', 'medium', 'high', 'xhigh']);
    await act(() => result.current.setEffort('default'));
    expect(invoke).not.toHaveBeenCalledWith('settings.setModelDefaults', expect.anything());
  });

  it('once the effort or the fast tier is set here, drops the choice older versions carried from chat to chat', async () => {
    localStorage.setItem('moxxy.model.tuning', JSON.stringify({ effort: 'high', fast: true }));
    const { result } = await loaded({ provider: 'openai-codex', model: 'gpt-6-luna' });

    await act(() => result.current.setModel('openai-codex', 'gpt-plain'));
    expect(localStorage.getItem('moxxy.model.tuning')).not.toBeNull();

    await act(() => result.current.setFast(false));
    expect(localStorage.getItem('moxxy.model.tuning')).toBeNull();
  });

  it('says why a save did not happen and keeps the old value', async () => {
    const { result } = await loaded({ provider: 'openai-codex', model: 'gpt-6-luna' }, { fail: true });

    await act(() => result.current.setFast(true));

    expect(result.current).toMatchObject({ fast: false, busy: false, error: 'config is read-only' });
  });

  it('offers nothing while no runner is connected', async () => {
    const { result } = await loaded({}, { info: null });

    expect(result.current).toMatchObject({ provider: null, model: null, providers: [] });
  });
});
