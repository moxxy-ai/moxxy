/**
 * The toast about the active agent's CLI: where it stands, the action that
 * fixes it, and closing it until the vendor publishes another version.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AgentCliReport, SessionInfo } from '@moxxy/sdk';
import { AgentUpdateToast } from './AgentUpdateToast';
import { useAgentCliNotices } from '../chat/useAgentCliNotice';
import { __resetToastsForTests, getToasts } from './toast-store';

afterEach(() => {
  __setApiOverride(null);
  __resetToastsForTests();
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

function host(prefs: Record<string, unknown> = {}, run: unknown = { ok: true, message: 'Updated' }) {
  const calls: Array<[string, unknown]> = [];
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'prefs.read') return { dismissedAgentUpdates: {}, ...prefs };
      if (cmd === 'prefs.update') return { dismissedAgentUpdates: {}, ...prefs, ...(args as object) };
      if (cmd === 'agents.run') return run;
      return undefined;
    },
    subscribe: () => () => undefined,
  } as never);
  return calls;
}

function Bar({ sessionInfo }: { readonly sessionInfo: SessionInfo }): JSX.Element | null {
  const notices = useAgentCliNotices(sessionInfo);
  return (
    <>
      {notices.map((notice) => (
        <AgentUpdateToast key={notice.notice.provider} notice={notice} />
      ))}
    </>
  );
}

describe('the agent CLI toast', () => {
  it('names the copy it is about and offers no button for one inside an app', async () => {
    const calls = host();
    const inside = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
    render(<Bar sessionInfo={info(report({ state: 'update-required', installed: '0.150.0', path: inside, origin: 'app' }))} />);

    const bar = await screen.findByTestId('agent-update-toast');
    expect(bar).toHaveAttribute('title', expect.stringContaining(inside));
    expect(bar).toHaveTextContent(`0.150.0 is older than Moxxy works with — it is part of ChatGPT.app, which updates it`);
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls.some(([cmd]) => cmd === 'agents.run')).toBe(false);
  });

  it('offers the update the vendor published, in the words the terminal uses', async () => {
    const calls = host();
    render(<Bar sessionInfo={info(report({}))} />);

    const bar = await screen.findByTestId('agent-update-toast');
    expect(bar).toHaveTextContent('Update available: Codex');
    expect(screen.getByText('v0.155.1 → v0.162.1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update Codex' }));
    await waitFor(() => expect(calls).toContainEqual(['agents.run', { provider: 'codex-agent', action: 'update' }]));
  });

  it('gives every agent with an update its own card, the active one first', async () => {
    host();
    const two = {
      activeProvider: 'codex-agent',
      providers: [
        { name: 'claude-code', agentName: 'Claude Code', models: [], agentCli: report({ command: 'claude', installed: '2.1.314', latest: '2.1.316' }) },
        { name: 'codex-agent', agentName: 'Codex', models: [], agentCli: report({}) },
      ],
    } as unknown as SessionInfo;
    render(<Bar sessionInfo={two} />);

    const cards = await screen.findAllByTestId('agent-update-toast');
    expect(cards.map((card) => card.getAttribute('data-provider'))).toEqual(['codex-agent', 'claude-code']);
    expect(cards[1]).toHaveTextContent('v2.1.314 → v2.1.316');
  });

  it('says the agent is ready once the update it ran went well', async () => {
    host();
    render(<Bar sessionInfo={info(report({}))} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update Codex' }));
    await waitFor(() => expect(getToasts()).toMatchObject([{ tone: 'success', title: 'Codex is ready' }]));
  });

  it('keeps a failed update on the card, with no word of success', async () => {
    host({}, { ok: false, message: 'npm could not write there' });
    render(<Bar sessionInfo={info(report({}))} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update Codex' }));
    expect(await screen.findByText('npm could not write there')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Codex' })).toHaveTextContent('Try again');
    expect(getToasts()).toEqual([]);
  });

  it('stays closed for that version once closed', async () => {
    const calls = host();
    render(<Bar sessionInfo={info(report({}))} />);

    await screen.findByTestId('agent-update-toast');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close' })));

    expect(calls).toContainEqual(['prefs.update', { dismissedAgentUpdates: { 'codex-agent': '0.162.1' } }]);
    expect(screen.queryByTestId('agent-update-toast')).toBeNull();
  });

  it('shows again for a newer version', async () => {
    host({ dismissedAgentUpdates: { 'codex-agent': '0.160.0' } });
    render(<Bar sessionInfo={info(report({}))} />);

    expect(await screen.findByTestId('agent-update-toast')).toBeInTheDocument();
  });

  it('cannot be closed when the agent cannot work without it', async () => {
    host({ dismissedAgentUpdates: { 'codex-agent': '0.162.1' } });
    render(<Bar sessionInfo={info(report({ state: 'update-required', installed: '0.150.0' }))} />);

    expect(await screen.findByTestId('agent-update-toast')).toHaveTextContent('Update required: Codex');
    expect(screen.getByText('v0.150.0 → v0.162.1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
