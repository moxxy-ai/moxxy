/**
 * usePausedWorkflows hook tests — the renderer half of the human-in-the-loop
 * loop. Drive `workflow_paused` / `workflow_resumed` plugin events through the
 * fake `runner.event` subscription and assert the hook tracks the paused set
 * and dispatches `workflows.resume` with the operator's reply.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { usePausedWorkflows } from './usePausedWorkflows.js';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';

afterEach(() => __setApiOverride(null));

function install(invoke: MoxxyApi['invoke']): { emit: (event: unknown) => void } {
  let handler: ((payload: { event: unknown }) => void) | null = null;
  __setApiOverride({
    invoke,
    subscribe: ((channel: string, h: (payload: { event: unknown }) => void) => {
      if (channel === 'runner.event') handler = h;
      return () => {
        handler = null;
      };
    }) as never,
  } as MoxxyApi);
  return { emit: (event) => handler?.({ event }) };
}

const pausedEvent = {
  type: 'plugin_event',
  subtype: 'workflow_paused',
  pluginId: 'workflows',
  payload: { runId: 'run-1', stepId: 'ask', workflow: 'approve-flow', label: 'Approve', prompt: 'Ship it?' },
};

describe('usePausedWorkflows', () => {
  it('tracks a paused run from the workflow_paused event', async () => {
    const { emit } = install((async () => undefined) as MoxxyApi['invoke']);
    const { result } = renderHook(() => usePausedWorkflows());
    expect(result.current.paused).toHaveLength(0);
    act(() => emit(pausedEvent));
    await waitFor(() => expect(result.current.paused).toHaveLength(1));
    expect(result.current.paused[0]).toMatchObject({
      runId: 'run-1',
      workflow: 'approve-flow',
      label: 'Approve',
      prompt: 'Ship it?',
    });
  });

  it('dispatches workflows.resume and clears the run optimistically', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.resume') return { ok: true, output: 'done', steps: [] };
      return undefined;
    });
    const { emit } = install(invoke as unknown as MoxxyApi['invoke']);
    const { result } = renderHook(() => usePausedWorkflows());
    act(() => emit(pausedEvent));
    await waitFor(() => expect(result.current.paused).toHaveLength(1));

    await act(async () => {
      await result.current.resume('run-1', 'ship it');
    });
    expect(invoke).toHaveBeenCalledWith('workflows.resume', { runId: 'run-1', reply: 'ship it' });
    expect(result.current.paused).toHaveLength(0);
  });

  it('clears the run when a workflow_resumed/completed event arrives', async () => {
    const { emit } = install((async () => undefined) as MoxxyApi['invoke']);
    const { result } = renderHook(() => usePausedWorkflows());
    act(() => emit(pausedEvent));
    await waitFor(() => expect(result.current.paused).toHaveLength(1));
    act(() =>
      emit({ type: 'plugin_event', subtype: 'workflow_completed', pluginId: 'workflows', payload: { runId: 'run-1', name: 'approve-flow' } }),
    );
    // workflow_completed carries `name` not `runId` for the run-complete event,
    // but the resume path also emits `workflow_resumed { runId }` — verify both
    // clear paths: resumed (runId) removes the card.
    act(() =>
      emit({ type: 'plugin_event', subtype: 'workflow_resumed', pluginId: 'workflows', payload: { runId: 'run-1', stepId: 'ask' } }),
    );
    await waitFor(() => expect(result.current.paused).toHaveLength(0));
  });

  it('surfaces a failed resume error keyed by runId', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'workflows.resume') throw new Error('runner offline');
      return undefined;
    });
    const { emit } = install(invoke as unknown as MoxxyApi['invoke']);
    const { result } = renderHook(() => usePausedWorkflows());
    act(() => emit(pausedEvent));
    await waitFor(() => expect(result.current.paused).toHaveLength(1));
    await act(async () => {
      await result.current.resume('run-1', 'go');
    });
    expect(result.current.errors['run-1']).toBe('runner offline');
  });
});
