import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, connectionStore } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useAgentSession } from './useAgentSession';
import type { SessionInfo } from './types';

const info: SessionInfo = {
  providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
  modes: ['default'],
  activeProvider: 'openai-codex',
  activeMode: 'default',
  activeModeBadge: null,
};

/** Tiny host that surfaces the hook's state so tests can assert on the DOM. */
function Probe({
  workspaceId,
  disabled,
}: {
  readonly workspaceId: string;
  readonly disabled: boolean;
}): JSX.Element {
  const agent = useAgentSession(workspaceId, disabled);
  if (!agent.info) return <div>no-info</div>;
  return (
    <div>
      <span>{agent.info.activeProvider}</span>
      <span data-testid="mode">{agent.info.activeMode}</span>
      <button type="button" onClick={() => void agent.onPickProviderModel('openai-codex', 'gpt-5')}>
        pick
      </button>
    </div>
  );
}

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

describe('useAgentSession', () => {
  it('refetches session.info when a starting session becomes ready', async () => {
    const invoke = installInfoSequence([null, info]);
    const { rerender } = render(<Probe workspaceId="session-a" disabled />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('openai-codex')).toBeNull();

    rerender(<Probe workspaceId="session-a" disabled={false} />);

    expect(await screen.findByText('openai-codex')).toBeInTheDocument();
    expect(screen.getByTestId('mode')).toHaveTextContent('default');
  });

  it('refetches session.info when the target session connection reaches connected', async () => {
    const invoke = installInfoSequence([null, info]);
    render(<Probe workspaceId="fresh-session" disabled={false} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('openai-codex')).toBeNull();

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
    render(<Probe workspaceId="fresh-session" disabled={false} />);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('openai-codex')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(screen.getByText('openai-codex')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps retrying session.info even when the connected snapshot is missed', async () => {
    vi.useFakeTimers();
    const invoke = installInfoSequence([null, info]);
    render(<Probe workspaceId="missed-snapshot-session" disabled={false} />);

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('openai-codex')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(screen.getByText('openai-codex')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('persists a picked model through the shared session.setModel command', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'session.info') return info;
      if (cmd === 'session.setModel') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    render(<Probe workspaceId="session-model" disabled={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('session.setModel', {
        workspaceId: 'session-model',
        model: 'gpt-5',
      }),
    );
  });
});
