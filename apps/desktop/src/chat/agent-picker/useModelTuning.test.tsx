import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';
import { forgetSharedTuningChoice, useModelTuning } from './useModelTuning';

const luna = { id: 'gpt-6-luna', supportsReasoning: true, supportsFast: true };
const plain = { id: 'plain', supportsReasoning: true };
const infoWith = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  sessionId: 's1',
  providers: [{ name: 'openai-codex', models: [luna, plain] }],
  modes: ['default'],
  activeProvider: 'openai-codex',
  activeMode: 'default',
  activeModeBadge: null,
  reasoningEffort: null,
  fast: false,
  ...over,
});

function installApi(fail?: string) {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === fail) throw new Error('runner too old');
  });
  __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
  return invoke;
}

beforeEach(() => localStorage.clear());
afterEach(() => __setApiOverride(null));

describe('useModelTuning', () => {
  it("shows the conversation's effort and fast mode and switches them on the runner", async () => {
    const invoke = installApi();
    const refreshed = vi.fn();
    window.addEventListener(SESSION_INFO_REFRESH_EVENT, refreshed);
    const { result } = renderHook(() => useModelTuning('ws', infoWith({ reasoningEffort: 'medium' }), 'gpt-6-luna'));
    expect(result.current).toMatchObject({ effort: 'medium', fast: false, canSetEffort: true, canSetFast: true });

    await act(() => result.current.setEffort('high'));
    await act(() => result.current.setFast(true));

    expect(invoke).toHaveBeenCalledWith('settings.setReasoning', { workspaceId: 'ws', effort: 'high' });
    expect(invoke).toHaveBeenCalledWith('settings.setFast', { workspaceId: 'ws', enabled: true });
    expect(result.current).toMatchObject({ effort: 'high', fast: true });
    expect(refreshed).toHaveBeenCalledTimes(2);
    window.removeEventListener(SESSION_INFO_REFRESH_EVENT, refreshed);
  });

  it('follows a change another client made', () => {
    installApi();
    const { result, rerender } = renderHook(({ info }) => useModelTuning('ws', info, 'gpt-6-luna'), { initialProps: { info: infoWith() } });
    rerender({ info: infoWith({ fast: true, reasoningEffort: 'low' }) });
    expect(result.current).toMatchObject({ effort: 'low', fast: true });
  });

  it('offers fast mode only for a model that has it', () => {
    installApi();
    const { result } = renderHook(() => useModelTuning('ws', infoWith(), 'plain'));
    expect(result.current).toMatchObject({ canSetEffort: true, canSetFast: false });
  });

  it("gives a new runner the person's last choice", async () => {
    const invoke = installApi();
    const first = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));
    await act(() => first.result.current.setEffort('high'));
    await act(() => first.result.current.setFast(true));
    first.unmount();
    invoke.mockClear();

    renderHook(() => useModelTuning('ws', infoWith({ sessionId: 's2' }), 'gpt-6-luna'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.setFast', { workspaceId: 'ws', enabled: true }));
    expect(invoke).toHaveBeenCalledWith('settings.setReasoning', { workspaceId: 'ws', effort: 'high' });
  });

  it('sends switches made in quick succession one after another, the last one winning', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const invoke = vi.fn(async (cmd: string, args: { effort?: string; enabled?: boolean }) => {
      order.push(`start ${cmd} ${args.effort ?? args.enabled}`);
      if (args.effort === 'low') await new Promise<void>((resolve) => (release = resolve));
      order.push(`end ${cmd} ${args.effort ?? args.enabled}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    const { result } = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));

    let both: Promise<unknown> = Promise.resolve();
    act(() => {
      both = Promise.all([result.current.setEffort('low'), result.current.setEffort('high')]);
    });
    await waitFor(() => expect(order).toEqual(['start settings.setReasoning low']));
    release();
    await act(() => both);

    expect(order).toEqual([
      'start settings.setReasoning low', 'end settings.setReasoning low',
      'start settings.setReasoning high', 'end settings.setReasoning high',
    ]);
    expect(result.current).toMatchObject({ effort: 'high', busy: false });
  });

  it('remembers both switches made from one render for the next runner', async () => {
    installApi();
    const { result } = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));
    await act(() => Promise.all([result.current.setEffort('high'), result.current.setFast(true)]));
    expect(JSON.parse(localStorage.getItem('moxxy.model.tuning.v2') ?? 'null')).toEqual({ ws: { effort: 'high', fast: true } });
  });

  it('keeps a choice in the workspace it was made in: another workspace starts with what its runner reports', async () => {
    const invoke = installApi();
    const first = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));
    await act(() => first.result.current.setEffort('high'));
    await act(() => first.result.current.setFast(true));
    first.unmount();
    invoke.mockClear();

    const other = renderHook(() => useModelTuning('other', infoWith({ sessionId: 's2', reasoningEffort: 'medium', fast: true }), 'gpt-6-luna'));
    await act(async () => {});

    expect(invoke).not.toHaveBeenCalled();
    expect(other.result.current).toMatchObject({ effort: 'medium', fast: true });
  });

  it('still hands a workspace without a choice of its own the one an older version carried from chat to chat', async () => {
    localStorage.setItem('moxxy.model.tuning', JSON.stringify({ effort: 'high', fast: true }));
    const invoke = installApi();

    renderHook(() => useModelTuning('new-ws', infoWith(), 'gpt-6-luna'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.setFast', { workspaceId: 'new-ws', enabled: true }));
    expect(invoke).toHaveBeenCalledWith('settings.setReasoning', { workspaceId: 'new-ws', effort: 'high' });
  });

  it('hands nothing over once that older choice was dropped', async () => {
    localStorage.setItem('moxxy.model.tuning', JSON.stringify({ effort: 'high', fast: true }));
    forgetSharedTuningChoice();
    const invoke = installApi();

    renderHook(() => useModelTuning('new-ws', infoWith(), 'gpt-6-luna'));
    await act(async () => {});

    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows reasoning that is on at the provider's default as Default, not Off", () => {
    installApi();
    const { result } = renderHook(() => useModelTuning('ws', infoWith({ reasoningEffort: 'default' }), 'gpt-6-luna'));
    expect(result.current.effort).toBe('default');
    expect(result.current.effortLevels).toEqual(['off', 'default', 'low', 'medium', 'high', 'xhigh']);
  });

  it('offers no Default level once the effort is a set one', () => {
    installApi();
    const { result } = renderHook(() => useModelTuning('ws', infoWith({ reasoningEffort: 'low' }), 'gpt-6-luna'));
    expect(result.current.effortLevels).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
  });

  it('says why a switch did not happen and keeps the old value', async () => {
    installApi('settings.setFast');
    const { result } = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));
    await act(() => result.current.setFast(true));
    expect(result.current).toMatchObject({ fast: false, error: 'runner too old' });
  });
});
