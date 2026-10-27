/**
 * The line above the message box about the active agent's CLI: the same words
 * the terminal shows, the action that fixes it, and closing it until the
 * vendor publishes another version.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AgentCliReport, SessionInfo } from '@moxxy/sdk';
import { AgentCliBar } from './AgentCliBar';
import { useAgentCliNotice } from '../useAgentCliNotice';

afterEach(() => {
  __setApiOverride(null);
});

const info = (agentCli: AgentCliReport): SessionInfo =>
  ({
    activeProvider: 'codex-agent',
    providers: [{ name: 'codex-agent', agentName: 'Codex', models: [], authKind: 'oauth', supportsLiveModelDiscovery: false, agentCli }],
  }) as unknown as SessionInfo;

const report = (over: Partial<AgentCliReport>): AgentCliReport => ({
  state: 'update-available',
  command: 'codex',
  installed: '0.155.1',
  latest: '0.162.1',
  minimum: '0.155.1',
  checkedAt: 1,
  ...over,
});

function host(prefs: Record<string, unknown> = {}) {
  const calls: Array<[string, unknown]> = [];
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'prefs.read') return { dismissedAgentUpdates: {}, ...prefs };
      if (cmd === 'prefs.update') return { dismissedAgentUpdates: {}, ...prefs, ...(args as object) };
      if (cmd === 'agents.run') return { ok: true, message: 'Updated' };
      return undefined;
    },
    subscribe: () => () => undefined,
  } as never);
  return calls;
}

function Bar({ sessionInfo }: { readonly sessionInfo: SessionInfo }): JSX.Element | null {
  const notice = useAgentCliNotice(sessionInfo);
  return notice ? <AgentCliBar notice={notice} /> : null;
}

describe('the agent CLI line above the message box', () => {
  it('names the copy it is about and offers no button for one inside an app', async () => {
    const calls = host();
    const inside = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
    render(<Bar sessionInfo={info(report({ state: 'update-required', installed: '0.150.0', path: inside, origin: 'app' }))} />);

    const bar = await screen.findByTestId('composer-agent-cli');
    expect(bar).toHaveTextContent(`Codex 0.150.0 at ${inside} is older than Moxxy works with — it is part of ChatGPT.app, which updates it`);
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls.some(([cmd]) => cmd === 'agents.run')).toBe(false);
  });

  it('offers the update the vendor published, in the words the terminal uses', async () => {
    const calls = host();
    render(<Bar sessionInfo={info(report({}))} />);

    const bar = await screen.findByTestId('composer-agent-cli');
    expect(bar).toHaveTextContent('Codex 0.162.1 is out — you have 0.155.1');
    fireEvent.click(screen.getByRole('button', { name: 'Update Codex' }));
    await waitFor(() => expect(calls).toContainEqual(['agents.run', { provider: 'codex-agent', action: 'update' }]));
  });

  it('stays closed for that version once closed', async () => {
    const calls = host();
    render(<Bar sessionInfo={info(report({}))} />);

    await screen.findByTestId('composer-agent-cli');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));

    expect(calls).toContainEqual(['prefs.update', { dismissedAgentUpdates: { 'codex-agent': '0.162.1' } }]);
    expect(screen.queryByTestId('composer-agent-cli')).toBeNull();
  });

  it('shows again for a newer version', async () => {
    host({ dismissedAgentUpdates: { 'codex-agent': '0.160.0' } });
    render(<Bar sessionInfo={info(report({}))} />);

    expect(await screen.findByTestId('composer-agent-cli')).toBeInTheDocument();
  });

  it('cannot be closed when the agent cannot work without it', async () => {
    host({ dismissedAgentUpdates: { 'codex-agent': '0.162.1' } });
    render(<Bar sessionInfo={info(report({ state: 'update-required', installed: '0.150.0' }))} />);

    const bar = await screen.findByTestId('composer-agent-cli');
    expect(bar.dataset.severity).toBe('required');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
