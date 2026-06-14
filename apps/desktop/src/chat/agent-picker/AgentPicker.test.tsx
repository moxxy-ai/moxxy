import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, connectionStore } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { AgentPicker } from './AgentPicker';
import type { SessionInfo } from './types';

const info: SessionInfo = {
  providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
  modes: ['default'],
  activeProvider: 'openai-codex',
  activeMode: 'default',
  activeModeBadge: null,
};

function installInfoSequence(values: ReadonlyArray<SessionInfo | null>) {
  let index = 0;
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd !== 'session.info') throw new Error(`unexpected ${cmd}`);
    const value = values[Math.min(index, values.length - 1)] ?? null;
    index += 1;
    return value;
  });
  __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
  return invoke;
}

afterEach(() => {
  vi.useRealTimers();
  __setApiOverride(null);
  connectionStore.setActive(null);
});

describe('AgentPicker', () => {
  it('refetches session.info when a starting session becomes ready', async () => {
    const invoke = installInfoSequence([null, info]);
    const { rerender } = render(<AgentPicker workspaceId="session-a" disabled />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Model:/)).toBeNull();

    rerender(<AgentPicker workspaceId="session-a" disabled={false} />);

    expect(await screen.findByText('openai-codex')).toBeInTheDocument();
    expect(screen.getByDisplayValue('default')).toBeInTheDocument();
  });

  it('refetches session.info when the target session connection reaches connected', async () => {
    const invoke = installInfoSequence([null, info]);
    render(<AgentPicker workspaceId="fresh-session" disabled={false} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Model:/)).toBeNull();

    act(() => {
      connectionStore.setSnapshot('fresh-session', {
        phase: {
          phase: 'connected',
          socket: '/tmp/fresh-session.sock',
          sessionId: 'fresh-session',
          activeProvider: 'openai-codex',
          activeMode: 'default',
        },
        cliPath: null,
        attempts: 0,
        log: [],
      });
    });

    expect(await screen.findByText('openai-codex')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying session.info after connected until a fresh runner exposes providers', async () => {
    vi.useFakeTimers();
    connectionStore.setSnapshot('fresh-session', {
      phase: {
        phase: 'connected',
        socket: '/tmp/fresh-session.sock',
        sessionId: 'fresh-session',
        activeProvider: 'openai-codex',
        activeMode: 'default',
      },
      cliPath: null,
      attempts: 0,
      log: [],
    });
    const invoke = installInfoSequence([null, info]);
    render(<AgentPicker workspaceId="fresh-session" disabled={false} />);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Model:/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(screen.getByText('openai-codex')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying session.info even when the connected snapshot is missed', async () => {
    vi.useFakeTimers();
    const invoke = installInfoSequence([null, info]);
    render(<AgentPicker workspaceId="missed-snapshot-session" disabled={false} />);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Model:/)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(screen.getByText('openai-codex')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
