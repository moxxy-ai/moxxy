/**
 * useAgentWork — the Agents panel's list, read from the chat's events and
 * the runner's "running now", with the work picked and Stop (the fake api
 * shim stands in for the host).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { AgentBackgroundWork, MoxxyEvent } from '@moxxy/sdk';
import { __setApiOverride } from './transport.js';
import { chatStore } from './chatStore.js';
import { focusAgentWork, onAgentWorkFocus, onShowInChat, showInChat, useAgentWork } from './useAgentWork.js';

afterEach(() => {
  __setApiOverride(null);
});

let nextWs = 0;
const ws = (): string => `work-ws-${(nextWs += 1)}`;

let seq = 0;
function pluginEvent(pluginId: string, subtype: string, payload: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { id: `w${seq}`, seq, ts: seq * 1000, turnId: 'T1', sessionId: 'S', source: 'plugin', type: 'plugin_event', pluginId, subtype, payload } as unknown as MoxxyEvent;
}
const listed = (...work: AgentBackgroundWork[]) => pluginEvent('@moxxy/agent-connection', 'background_work', { provider: 'claude-code', work });
const server: AgentBackgroundWork = { id: 'b1', kind: 'command', label: 'npm run dev' };

function host(running: ReadonlyArray<AgentBackgroundWork>) {
  const calls: Array<[string, unknown]> = [];
  const state = { running, infoChanged: null as ((p: { workspaceId: string }) => void) | null };
  const api = {
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'session.info') return { backgroundWork: state.running };
      if (cmd === 'session.stopBackgroundWork') return true;
      return undefined;
    },
    subscribe: (event: string, fn: (p: { workspaceId: string }) => void) => {
      if (event === 'session.info.changed') state.infoChanged = fn;
      return () => undefined;
    },
  };
  __setApiOverride(api as unknown as MoxxyApi);
  return {
    calls,
    change(workspaceId: string, next: ReadonlyArray<AgentBackgroundWork>) {
      state.running = next;
      state.infoChanged?.({ workspaceId });
    },
  };
}

describe('useAgentWork', () => {
  it("lists the conversation's background work, and follows what runs now as the runner says", async () => {
    const id = ws();
    const h = host([server]);
    chatStore.dispatch(id, { type: 'event', event: listed(server) });
    const { result } = renderHook(() => useAgentWork(id));

    await waitFor(() => expect(result.current.items.map((item) => [item.id, item.status])).toEqual([['b1', 'running']]));
    expect(result.current.running).toBe(1);

    act(() => h.change(id, []));
    await waitFor(() => expect(result.current.items[0]?.status).toBe('stopped'));
    expect(result.current.running).toBe(0);
  });

  it('stops one work through the host, and marks it stopping until the runner says it ended', async () => {
    const id = ws();
    const h = host([server]);
    chatStore.dispatch(id, { type: 'event', event: listed(server) });
    const { result } = renderHook(() => useAgentWork(id));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.stop('b1');
    });

    expect(h.calls).toContainEqual(['session.stopBackgroundWork', { workspaceId: id, workId: 'b1' }]);
    expect(result.current.stopping.has('b1')).toBe(true);
    act(() => h.change(id, []));
    await waitFor(() => expect(result.current.stopping.has('b1')).toBe(false));
  });

  it('picks the work another part of the window asks to show, and tells the window to open the panel', async () => {
    const id = ws();
    host([server]);
    chatStore.dispatch(id, { type: 'event', event: listed(server) });
    const opened: string[] = [];
    const off = onAgentWorkFocus((workspaceId) => opened.push(workspaceId));
    const { result } = renderHook(() => useAgentWork(id));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => focusAgentWork(id, 'b1'));

    expect(result.current.selected?.id).toBe('b1');
    expect(opened).toEqual([id]);
    act(() => result.current.select(null));
    expect(result.current.selected).toBeNull();
    off();
  });

  it('asks the chat to show the turn a work opened, so the panel points back at the chat', () => {
    const shown: Array<[string, string]> = [];
    const off = onShowInChat((workspaceId, eventId) => shown.push([workspaceId, eventId]));

    showInChat('ws-a', 'e7');
    off();
    showInChat('ws-a', 'e8');

    expect(shown).toEqual([['ws-a', 'e7']]);
  });
});
