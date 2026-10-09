/**
 * useUpdateActivity — what the installer screen is drawn from: the update this
 * window watches the host carry out, and what the launch after it sets up.
 * Driven through the fake `api` shim (the IPC transport).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AppSetupState, AppUpdatePlan, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { useUpdateActivity } from './useUpdateActivity.js';

const listeners = new Map<string, (payload: unknown) => void>();
const emit = (event: string, payload: unknown): void => act(() => listeners.get(event)?.(payload));

function host(answers: Record<string, unknown | (() => Promise<unknown>)>) {
  const invoke = vi.fn(async (cmd: string) => {
    if (!(cmd in answers)) throw new Error(`unexpected ${cmd}`);
    const answer = answers[cmd];
    return typeof answer === 'function' ? (answer as () => Promise<unknown>)() : answer;
  });
  const subscribe = ((event: string, listener: (payload: unknown) => void) => {
    listeners.set(event, listener);
    return () => listeners.delete(event);
  }) as MoxxyApi['subscribe'];
  __setApiOverride({ invoke: invoke as unknown as MoxxyApi['invoke'], subscribe });
  return invoke;
}

afterEach(() => {
  __setApiOverride(null);
  listeners.clear();
});

const settingUp: AppSetupState = {
  reason: 'update',
  phase: 'running',
  steps: [{ id: 'extensions', status: 'running' }],
  notes: [],
};
const setUp: AppSetupState = { ...settingUp, phase: 'done', steps: [{ id: 'extensions', status: 'done' }] };
const plan: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [
    { id: 'app', status: 'running' },
    { id: 'restart', status: 'pending' },
  ],
};

describe('useUpdateActivity', () => {
  it('asks what this launch is setting up, and follows it', async () => {
    host({ 'app.setup': settingUp });
    const { result } = renderHook(() => useUpdateActivity());
    expect(result.current.setup).toBeNull();

    await waitFor(() => expect(result.current.setup).toEqual(settingUp));
    emit('app.setup.changed', setUp);

    expect(result.current.setup).toEqual(setUp);
  });

  it('keeps what the host pushed over an answer that arrives later', async () => {
    let answer: (state: AppSetupState) => void = () => undefined;
    host({ 'app.setup': () => new Promise<AppSetupState>((resolve) => (answer = resolve)) });
    const { result } = renderHook(() => useUpdateActivity());

    emit('app.setup.changed', setUp);
    await act(async () => answer(settingUp));

    expect(result.current.setup).toEqual(setUp);
  });

  it('has no update until one starts, then follows its plan and progress', async () => {
    host({ 'app.setup': setUp });
    const { result } = renderHook(() => useUpdateActivity());
    expect(result.current.plan).toBeNull();

    emit('app.update.plan', plan);
    emit('app.update.progress', { phase: 'download', received: 5, total: 10 });

    expect(result.current.plan).toEqual(plan);
    expect(result.current.progress).toEqual({ phase: 'download', received: 5, total: 10 });
  });

  it('asks the host for the update again', async () => {
    const invoke = host({ 'app.setup': setUp, 'app.updateAll': { ok: true, plan: null } });
    const { result } = renderHook(() => useUpdateActivity());

    await act(async () => result.current.retry());

    expect(invoke).toHaveBeenCalledWith('app.updateAll');
  });

  it('treats a host that cannot say what it is setting up as having nothing to set up', async () => {
    host({});
    const { result } = renderHook(() => useUpdateActivity());

    await waitFor(() => expect(result.current.setup).toEqual({ reason: null, phase: 'done', steps: [], notes: [] }));
  });
});
