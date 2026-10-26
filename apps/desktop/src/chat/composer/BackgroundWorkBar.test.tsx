/**
 * The line above the message box while the agent runs work in the background:
 * what runs, and the way into the Agents pane.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride, chatStore, onAgentWorkFocus } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { AgentBackgroundWork, MoxxyEvent } from '@moxxy/sdk';
import { BackgroundWorkBar } from './BackgroundWorkBar';
import { useBackgroundWorkBar } from './useBackgroundWorkBar';

afterEach(() => __setApiOverride(null));

function Harness({ workspaceId }: { readonly workspaceId: string }): JSX.Element | null {
  const bar = useBackgroundWorkBar(workspaceId);
  return bar ? <BackgroundWorkBar bar={bar} /> : null;
}

function host(running: ReadonlyArray<AgentBackgroundWork>): void {
  __setApiOverride({
    invoke: async (cmd: string) => (cmd === 'session.info' ? { backgroundWork: running } : undefined),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
}
const listed = (work: ReadonlyArray<AgentBackgroundWork>): MoxxyEvent =>
  ({ id: 'bw1', seq: 1, ts: 1000, turnId: 'T1', sessionId: 'S', source: 'system', type: 'plugin_event', pluginId: '@moxxy/agent-connection', subtype: 'background_work', payload: { provider: 'codex-agent', work } }) as unknown as MoxxyEvent;

describe('BackgroundWorkBar', () => {
  it('says what runs in the background and opens the Agents pane', async () => {
    const work: AgentBackgroundWork[] = [
      { id: 'b1', kind: 'command', label: 'npm run dev' },
      { id: 'sub-1', kind: 'agent', label: 'Check later' },
    ];
    host(work);
    chatStore.dispatch('bar-ws-1', { type: 'event', event: listed(work) });
    const opened: string[] = [];
    const off = onAgentWorkFocus((workspaceId) => opened.push(workspaceId));
    render(<Harness workspaceId="bar-ws-1" />);

    const bar = await screen.findByRole('button', { name: /In the background/ });
    expect(bar).toHaveTextContent('Check later, npm run dev');
    fireEvent.click(bar);

    expect(opened).toEqual(['bar-ws-1']);
    off();
  });

  it('says when the agent comes back by itself, how soon, and what for, and opens the Agents pane', async () => {
    __setApiOverride({
      invoke: async (cmd: string) =>
        cmd === 'session.info'
          ? { backgroundWork: [], scheduledWakeups: [{ id: 'c1', prompt: 'Check CI on main', dueAtMs: Date.now() + 5 * 60_000 + 30_000, recurring: false }] }
          : undefined,
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    const opened: string[] = [];
    const off = onAgentWorkFocus((workspaceId) => opened.push(workspaceId));
    render(<Harness workspaceId="bar-ws-3" />);

    const line = await screen.findByRole('button', { name: /^Back at .+ · in 5 min/ });
    expect(line).toHaveTextContent('Check CI on main');
    expect(screen.queryByRole('button', { name: /In the background/ })).toBeNull();
    fireEvent.click(line);

    expect(opened).toEqual(['bar-ws-3']);
    off();
  });

  it('is not there while nothing runs in the background', async () => {
    host([]);
    render(<Harness workspaceId="bar-ws-2" />);
    await waitFor(() => expect(screen.queryByRole('button', { name: /In the background/ })).toBeNull());
  });
});
