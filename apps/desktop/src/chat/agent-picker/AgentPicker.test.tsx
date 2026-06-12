import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
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
  __setApiOverride(null);
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
});
