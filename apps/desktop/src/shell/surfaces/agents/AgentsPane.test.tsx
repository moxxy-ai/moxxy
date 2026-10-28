/**
 * AgentsPane — the agent's helpers and background commands of one chat: a
 * list, the mini chat of the one picked, and Stop.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { __resetDesksStoreForTests, __setApiOverride, chatStore, onShowInChat } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { AgentBackgroundWork, MoxxyEvent } from '@moxxy/sdk';
import { AgentsPane } from './AgentsPane';

afterEach(() => {
  __setApiOverride(null);
  __resetDesksStoreForTests();
});

/** The browser's clipboard, the one boundary here that is not the IPC. */
let clipboard: string[] = [];
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void clipboard.push(text) },
  });
});

let nextWs = 0;
const ws = (): string => `agents-pane-${(nextWs += 1)}`;
let seq = 0;
function event(fields: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { id: `p${seq}`, seq, ts: seq * 1000, turnId: 'T1', sessionId: 'S', source: 'plugin', ...fields } as unknown as MoxxyEvent;
}
const helper = (subtype: string, payload: Record<string, unknown>) =>
  event({ type: 'plugin_event', pluginId: '@moxxy/subagents', subtype, payload });
const work = (subtype: string, payload: Record<string, unknown>) =>
  event({ type: 'plugin_event', pluginId: '@moxxy/agent-connection', subtype, payload: { provider: 'claude-code', ...payload } });

function host(running: ReadonlyArray<AgentBackgroundWork>) {
  const calls: Array<[string, unknown]> = [];
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'session.info') return { backgroundWork: running };
      if (cmd === 'session.stopBackgroundWork') return true;
      return undefined;
    },
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
  return calls;
}

function seed(id: string, events: MoxxyEvent[]): void {
  for (const e of events) chatStore.dispatch(id, { type: 'event', event: e });
}

const server: AgentBackgroundWork = { id: 'b1', kind: 'command', label: 'npm run dev' };

describe('AgentsPane', () => {
  it('lists when the agent set itself to come back, above what runs, with the time and how soon', async () => {
    const id = ws();
    const inFiveMinutes = Date.now() + 5 * 60_000 + 30_000;
    __setApiOverride({
      invoke: async (cmd: string) =>
        cmd === 'session.info' ? { backgroundWork: [], scheduledWakeups: [{ id: 'c1', prompt: 'Check CI on main', dueAtMs: inFiveMinutes, recurring: false }] } : undefined,
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    render(<AgentsPane workspaceId={id} />);

    const group = await screen.findByRole('group', { name: 'Scheduled' });
    expect(within(group).getByText('Check CI on main')).toBeTruthy();
    expect(within(group).getByText(/^Back at .+ · in 5 min$/)).toBeTruthy();
    expect(screen.queryByText('No background work in this chat yet')).toBeNull();
  });

  it('says there is nothing yet when the agent ran no helper and no background command', () => {
    host([]);
    render(<AgentsPane workspaceId={ws()} />);
    expect(screen.getByText('No background work in this chat yet')).toBeTruthy();
  });

  it("opens a helper's mini chat: its task, what it said and did, and its answer", async () => {
    const id = ws();
    host([]);
    seed(id, [
      helper('subagent_started', { childSessionId: 'sub-1', label: 'List files', agentType: 'Explore', prompt: 'list the files' }),
      helper('subagent_message', { childSessionId: 'sub-1', text: 'Listing the folder.' }),
      helper('subagent_tool_call', { childSessionId: 'sub-1', name: 'Bash', input: { command: 'ls' } }),
      helper('subagent_completed', { childSessionId: 'sub-1', text: 'Two files.', stopReason: 'end_turn' }),
    ]);
    render(<AgentsPane workspaceId={id} />);

    fireEvent.click(await screen.findByRole('button', { name: /List files/ }));

    const detail = screen.getByRole('region', { name: 'List files' });
    expect(within(detail).getByText('list the files')).toBeTruthy();
    expect(within(detail).getByText('Listing the folder.')).toBeTruthy();
    expect(within(detail).getByText('Bash')).toBeTruthy();
    expect(within(detail).getByText('Two files.')).toBeTruthy();
    expect(within(detail).queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'All work' }));
    expect(screen.queryByRole('region', { name: 'List files' })).toBeNull();
  });

  it('stops a command that runs in the background, and shows what an ended one printed', async () => {
    const id = ws();
    const calls = host([server]);
    seed(id, [
      work('background_work', { work: [server] }),
      work('background_work_ended', { id: 'b0', kind: 'command', label: 'npm test', status: 'failed', output: '1 failed' }),
    ]);
    render(<AgentsPane workspaceId={id} />);

    fireEvent.click(await screen.findByRole('button', { name: /npm run dev/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });
    expect(calls).toContainEqual(['session.stopBackgroundWork', { workspaceId: id, workId: 'b1' }]);

    fireEvent.click(screen.getByRole('button', { name: 'All work' }));
    fireEvent.click(screen.getByRole('button', { name: /npm test/ }));
    expect(screen.getByText('1 failed')).toBeTruthy();
  });

  it("names a command once, when the agent's summary of it only repeats the command", async () => {
    const id = ws();
    host([]);
    seed(id, [
      work('background_work_ended', { id: 'b0', kind: 'command', label: 'npm test', status: 'completed', summary: 'npm test', output: 'ok' }),
      work('background_work_ended', { id: 'b9', kind: 'command', label: 'npm run e2e', status: 'failed', summary: 'exit code 1', output: 'boom' }),
    ]);
    render(<AgentsPane workspaceId={id} />);

    fireEvent.click(await screen.findByRole('button', { name: /npm test/ }));
    expect(screen.getAllByText('npm test')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'All work' }));
    fireEvent.click(screen.getByRole('button', { name: /npm run e2e/ }));
    expect(screen.getByText('exit code 1')).toBeTruthy();
  });

  it('points back at the turn the agent opened when the work ended', async () => {
    const id = ws();
    host([]);
    seed(id, [
      helper('subagent_started', { childSessionId: 'sub-1', label: 'List files', agentType: 'Explore' }),
      helper('subagent_completed', { childSessionId: 'sub-1', text: 'Two files.', stopReason: 'end_turn' }),
      event({ type: 'user_prompt', source: 'system', id: 'turn-2', text: 'x', origin: { kind: 'agent', name: 'x', workId: 'sub-1' } }),
    ]);
    const shown: string[] = [];
    const off = onShowInChat((_ws, eventId) => shown.push(eventId));
    render(<AgentsPane workspaceId={id} />);

    fireEvent.click(await screen.findByRole('button', { name: /List files/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in chat' }));

    await waitFor(() => expect(shown).toEqual(['turn-2']));
    off();
  });

  it("offers a running command's actions on its menu: Stop, and Copy command with the command the agent ran", async () => {
    const id = ws();
    const dev: AgentBackgroundWork = { id: 'b1', kind: 'command', label: 'Start dev server' };
    const calls = host([dev]);
    seed(id, [
      event({ type: 'tool_call_requested', callId: 'c1', name: 'Bash', input: { command: 'npm run dev -- --port 5198', description: 'Start dev server', run_in_background: true } }),
      work('background_work', { work: [dev] }),
    ]);
    render(<AgentsPane workspaceId={id} />);

    await screen.findByRole('button', { name: /Start dev server/ });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'Start dev server' });
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy command' }));
    });
    expect(clipboard).toEqual(['npm run dev -- --port 5198']);

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Stop' }));
    });
    expect(calls).toContainEqual(['session.stopBackgroundWork', { workspaceId: id, workId: 'b1' }]);
  });

  it('opens the same menu on a right click, and offers no Stop on work that ended or a command it cannot name', async () => {
    const id = ws();
    host([]);
    seed(id, [work('background_work_ended', { id: 'b0', kind: 'command', label: 'npm test', status: 'completed' })]);
    render(<AgentsPane workspaceId={id} />);

    fireEvent.contextMenu(await screen.findByRole('button', { name: /npm test/ }));
    const menu = screen.getByRole('menu', { name: 'npm test' });
    expect(within(menu).queryByRole('menuitem', { name: 'Stop' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Copy command' })).toBeNull();
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy name' }));
    });
    expect(clipboard).toEqual(['npm test']);
  });

  it("shows what runs in the background in the project's other chats, with the chat's name, and stops it there", async () => {
    const here = ws();
    const there = ws();
    const calls: Array<[string, unknown]> = [];
    __setApiOverride({
      invoke: async (cmd: string, args: { workspaceId?: string } | undefined) => {
        calls.push([cmd, args]);
        if (cmd === 'desks.list') {
          return {
            activeId: 'd1',
            desks: [{ id: 'd1', name: 'App', cwd: '/p', color: '', createdAt: 0, activeSessionId: here, sessions: [
              { id: here, name: 'Fix login', createdAt: 0 },
              { id: there, name: 'Dev server chat', createdAt: 0 },
            ] }],
          };
        }
        if (cmd === 'session.info') return { backgroundWork: args?.workspaceId === there ? [server] : [] };
        if (cmd === 'session.stopBackgroundWork') return true;
        return undefined;
      },
      subscribe: () => () => undefined,
    } as unknown as MoxxyApi);
    render(<AgentsPane workspaceId={here} />);

    expect(screen.getByText('No background work in this chat yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Whole project' }));
    const running = await screen.findByRole('group', { name: 'Running' });
    expect(within(running).getByText('npm run dev')).toBeTruthy();
    expect(within(running).getByText('Command · Dev server chat')).toBeTruthy();

    fireEvent.click(within(running).getByRole('button', { name: 'More' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Stop' }));
    });
    expect(calls).toContainEqual(['session.stopBackgroundWork', { workspaceId: there, workId: 'b1' }]);

    fireEvent.click(screen.getByRole('button', { name: 'This chat' }));
    expect(screen.getByText('No background work in this chat yet')).toBeTruthy();
  });

  it('says when nothing runs in the background anywhere in the project', async () => {
    host([]);
    render(<AgentsPane workspaceId={ws()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Whole project' }));
    expect(await screen.findByText('Nothing runs in the background in this project')).toBeTruthy();
  });
});
