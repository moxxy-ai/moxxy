import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { SESSION_INFO_REFRESH_EVENT, type SessionInfo } from './types';
import { useModelTuning } from './useModelTuning';

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

  it('says why a switch did not happen and keeps the old value', async () => {
    installApi('settings.setFast');
    const { result } = renderHook(() => useModelTuning('ws', infoWith(), 'gpt-6-luna'));
    await act(() => result.current.setFast(true));
    expect(result.current).toMatchObject({ fast: false, error: 'runner too old' });
  });
});
