import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, chatStore, connectionStore } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useAgentSession, type ModelOwner } from './useAgentSession';
import { setModelPreference } from './modelPreferences';
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
  modelOwner,
}: {
  readonly workspaceId: string;
  readonly disabled: boolean;
  readonly modelOwner?: ModelOwner;
}): JSX.Element {
  const agent = useAgentSession(workspaceId, disabled, modelOwner);
  if (!agent.info) return <div>no-info</div>;
  return (
    <div>
      <span>{agent.info.activeProvider}</span>
      <span data-testid="mode">{agent.info.activeMode}</span>
      <span data-testid="selected-model">{agent.selectedModel ?? 'default'}</span>
      <button type="button" onClick={() => void agent.onPickProviderModel('openai-codex', 'gpt-5')}>
        pick
      </button>
      <button type="button" onClick={() => void agent.onPickProviderModel('openai-codex', null)}>
        pick provider
      </button>
      <button
        type="button"
        onClick={() => void agent.onPickProviderModel('openai-codex', 'vendor/model-v2', 200_000)}
      >
        pick custom
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
  localStorage.clear();
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
        contextWindow: null,
      }),
    );
  });

  it('persists custom model context metadata through session.setModel', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'session.info') return info;
      if (cmd === 'session.setModel') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    render(<Probe workspaceId="custom-model-context" disabled={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'pick custom' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.setModel', {
      workspaceId: 'custom-model-context',
      model: 'vendor/model-v2',
      contextWindow: 200_000,
    }));
    expect(chatStore.getModelContextWindow('custom-model-context')).toBe(200_000);
  });

  it('restores the exact provider model after the desktop restarts', async () => {
    const workspaceId = 'restart-model';
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'session.info') return info;
      if (cmd === 'session.setModel') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const first = render(<Probe workspaceId={workspaceId} disabled={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'pick' }));
    await waitFor(() => expect(screen.getByTestId('selected-model')).toHaveTextContent('gpt-5'));
    first.unmount();

    chatStore.setModel(workspaceId, null);
    invoke.mockClear();
    render(<Probe workspaceId={workspaceId} disabled={false} />);

    await waitFor(() => expect(screen.getByTestId('selected-model')).toHaveTextContent('gpt-5'));
    expect(invoke).toHaveBeenCalledWith('session.setModel', {
      workspaceId,
      model: 'gpt-5',
      contextWindow: null,
    });
  });

  it('restores the custom model context window after the desktop restarts', async () => {
    const workspaceId = 'restart-custom-model';
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'session.info') return info;
      if (cmd === 'session.setModel') return undefined;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);

    const first = render(<Probe workspaceId={workspaceId} disabled={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'pick custom' }));
    await waitFor(() => expect(chatStore.getModelContextWindow(workspaceId)).toBe(200_000));
    first.unmount();

    chatStore.setModel(workspaceId, null);
    invoke.mockClear();
    render(<Probe workspaceId={workspaceId} disabled={false} />);

    await waitFor(() => expect(chatStore.getModelContextWindow(workspaceId)).toBe(200_000));
    expect(invoke).toHaveBeenCalledWith('session.setModel', {
      workspaceId,
      model: 'vendor/model-v2',
      contextWindow: 200_000,
    });
  });
});

describe("useAgentSession in a bot's chat (the bot owns the model)", () => {
  it("keeps the bot's model instead of restoring the app's own pick over it", async () => {
    const invoke = installInfoSequence([info]);
    setModelPreference('moxxy-channel-telegram', 'openai-codex', 'gpt-4', null);
    chatStore.setModel('moxxy-channel-telegram', 'gpt-5.6-luna', null);

    render(
      <Probe workspaceId="moxxy-channel-telegram" disabled={false} modelOwner={{ pick: async () => undefined }} />,
    );

    expect(await screen.findByText('openai-codex')).toBeInTheDocument();
    expect(screen.getByTestId('selected-model')).toHaveTextContent('gpt-5.6-luna');
    expect(invoke.mock.calls.map(([cmd]) => cmd)).not.toContain('session.setModel');
  });

  it("saves a model picked in the header as the bot's model", async () => {
    const invoke = installInfoSequence([info]);
    const pick = vi.fn(async () => undefined);
    render(<Probe workspaceId="moxxy-channel-telegram" disabled={false} modelOwner={{ pick }} />);

    fireEvent.click(await screen.findByText('pick'));
    fireEvent.click(screen.getByText('pick provider'));

    await waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
    expect(pick).toHaveBeenNthCalledWith(1, 'openai-codex', 'gpt-5');
    // A provider alone means its first model — a bot's model always names one.
    expect(pick).toHaveBeenNthCalledWith(2, 'openai-codex', 'gpt-5');
    expect(invoke.mock.calls.map(([cmd]) => cmd)).not.toContain('session.setProvider');
  });
});
