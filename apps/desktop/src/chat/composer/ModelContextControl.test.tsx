import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
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
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'session.info') return info;
    if (cmd === 'settings.adminProviders') return [];
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
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
});
