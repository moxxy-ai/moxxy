/**
 * useWorkflowApprovals — the requests a workflow is waiting on. Only a
 * connected runner can answer; asking before it is up fails every time and
 * the host logs each failure. Driven through the fake `api` shim (the IPC
 * transport).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConnectionPhase, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { __setApiOverride } from './transport.js';
import { connectionStore } from './useConnection.js';
import { useWorkflowApprovals } from './useWorkflowApprovals.js';

const WORKSPACE = 'w-approvals';
const CONNECTED: ConnectionPhase = {
  phase: 'connected',
  socket: '/tmp/moxxy.sock',
  sessionId: 's-1',
  activeProvider: null,
  activeMode: null,
};
const STARTING: ConnectionPhase = { phase: 'reconnecting', reason: 'starting the agent runtime', attempt: 0 };

const setPhase = (phase: ConnectionPhase): void =>
  act(() => connectionStore.setSnapshot(WORKSPACE, { phase, cliPath: null, attempts: 0, log: [] }));

function host(approvals: () => Promise<unknown>) {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd !== 'workflows.approvals') throw new Error(`unexpected ${cmd}`);
    return approvals();
  });
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => {}) as MoxxyApi['subscribe'],
  });
  return invoke;
}

const item = {
  id: '3f2b1c9e-5a47-4d1e-9b0a-6c2d8e7f1a34',
  workflowId: 'wf',
  workflowName: 'Daily report',
  revision: 'r1',
  runId: 'run1',
  tool: 'Write',
  input: { path: 'report.txt' },
  createdAt: 1,
  status: 'pending',
};

afterEach(() => {
  __setApiOverride(null);
  vi.useRealTimers();
});

describe('useWorkflowApprovals', () => {
  it('does not ask while the runner is still starting', async () => {
    setPhase(STARTING);
    const invoke = host(async () => {
      throw new Error('not connected to a runner');
    });

    const { result } = renderHook(() => useWorkflowApprovals(WORKSPACE));
    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it('asks as soon as the runner connects', async () => {
    setPhase(STARTING);
    const invoke = host(async () => [item]);
    const { result } = renderHook(() => useWorkflowApprovals(WORKSPACE));
    expect(invoke).not.toHaveBeenCalled();

    setPhase(CONNECTED);

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(invoke).toHaveBeenCalledWith('workflows.approvals', { workspaceId: WORKSPACE });
  });

  it('stops asking when the runner goes away, and keeps what it knew', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setPhase(CONNECTED);
    const invoke = host(async () => [item]);
    const { result } = renderHook(() => useWorkflowApprovals(WORKSPACE));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const asked = invoke.mock.calls.length;

    setPhase({ phase: 'reconnecting', reason: 'the runner stopped', attempt: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(invoke.mock.calls.length).toBe(asked);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });
});
