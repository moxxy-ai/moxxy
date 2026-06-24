import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';
import { ModelContextControl } from './ModelContextControl';
import type { SessionInfo } from '../agent-picker/types';

const info: SessionInfo = {
  providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5' }] }],
  modes: ['default'],
  activeProvider: 'openai-codex',
  activeMode: 'default',
  activeModeBadge: null,
};

function installApi(): void {
  // session.info (fetched by useContextUsage) carries the active model's context
  // window — without it the meters can't compute a fraction, so seed one here.
  const sessionInfo = {
    ...info,
    providers: [{ name: 'openai-codex', models: [{ id: 'gpt-5', contextWindow: 1000 }] }],
  };
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'session.info') return sessionInfo;
    if (cmd === 'settings.adminProviders') return [];
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
}

/** Fold one prompt-bearing provider_response into the store so the workspace
 *  reports `inputTokens` of used context (drives the meter + composition). */
function seedUsage(workspaceId: string, inputTokens: number): void {
  chatStore.dispatch(workspaceId, {
    type: 'event',
    event: {
      id: 'e1',
      seq: 1,
      ts: 1,
      turnId: 'T1',
      sessionId: 'S',
      source: 'model',
      type: 'provider_response',
      provider: 'p',
      model: 'm',
      inputTokens,
    } as unknown as MoxxyEvent,
  });
}

afterEach(() => {
  __setApiOverride(null);
});

describe('ModelContextControl', () => {
  it('shows the active model name (provider fallback) as a quiet label', () => {
    installApi();
    render(
      <ModelContextControl
        workspaceId="ws"
        info={info}
        selectedModel={null}
        disabled={false}
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByText('openai-codex')).toBeInTheDocument();
  });

  it('opens the combined panel and commits a picked model via onPick', async () => {
    installApi();
    const onPick = vi.fn();
    render(
      <ModelContextControl
        workspaceId="ws"
        info={info}
        selectedModel={null}
        disabled={false}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open model & context/i }));
    // The panel composes both the model grid and the context usage panel.
    expect(await screen.findByText('Model & context')).toBeInTheDocument();
    expect(screen.getByText('Context window')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('option', { name: 'gpt-5' }));

    expect(onPick).toHaveBeenCalledWith('openai-codex', 'gpt-5');
    // Picking a model closes the panel.
    await waitFor(() => expect(screen.queryByText('Model & context')).toBeNull());
  });

  it('renders an inline context-usage percentage on the trigger button', async () => {
    installApi();
    // 100 used tokens against a 1.0k window → 10%.
    seedUsage('ws-meter', 100);
    render(
      <ModelContextControl
        workspaceId="ws-meter"
        info={info}
        selectedModel={null}
        disabled={false}
        onPick={vi.fn()}
      />,
    );
    // The meter waits on the async session.info fetch for the context window.
    expect(await screen.findByText('10%')).toBeInTheDocument();
  });

  it('keeps the prompt-composition detail collapsed until expanded', async () => {
    installApi();
    seedUsage('ws-collapse', 100);
    render(
      <ModelContextControl
        workspaceId="ws-collapse"
        info={info}
        selectedModel={null}
        disabled={false}
        onPick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open model & context/i }));
    // The composition header shows by default, but its breakdown rows stay hidden.
    expect(await screen.findByText('Prompt composition')).toBeInTheDocument();
    expect(screen.queryByText('Cache read')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /prompt composition/i }));
    expect(await screen.findByText('Cache read')).toBeInTheDocument();
  });
});
