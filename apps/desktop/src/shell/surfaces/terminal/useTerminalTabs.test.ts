/**
 * useTerminalTabs: the tab strip of the terminal pane, over the IPC boundary
 * (`terminal.*`), the one double here. The Agent tab is always first and is
 * the runner's terminal; the others are the project's own shells.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, TerminalTabInfo } from '@moxxy/desktop-ipc-contract';
import { AGENT_TAB, useTerminalTabs } from './useTerminalTabs';

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

/** A main process holding the project's tabs, and what the pane asked of it. */
function host(initial: TerminalTabInfo[] = []) {
  let tabs = [...initial];
  let n = initial.length;
  const calls: Array<[string, unknown]> = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  __setApiOverride({
    invoke: async (cmd: string, args: { tabId?: string }) => {
      calls.push([cmd, args]);
      if (cmd === 'desks.list') return { desks: [], activeId: null };
      if (cmd === 'terminal.list') return tabs;
      if (cmd === 'terminal.open') {
        n += 1;
        const tab = { id: `t${n}`, title: `Terminal ${n}` };
        tabs = [...tabs, tab];
        return tab;
      }
      if (cmd === 'terminal.close') tabs = tabs.filter((t) => t.id !== args.tabId);
      return undefined;
    },
    subscribe: (event: string, cb: (payload: unknown) => void) => {
      listeners.set(event, cb);
      return () => listeners.delete(event);
    },
  } as unknown as MoxxyApi);
  return {
    calls,
    /** Main says the project's tabs changed (a shell exited, another window opened one). */
    changed: (next: TerminalTabInfo[]) => {
      tabs = next;
      act(() => listeners.get('terminal.tabsChanged')?.({ projectId: 'p' }));
    },
  };
}

describe('useTerminalTabs', () => {
  it("starts on the Agent tab and lists the project's tabs after it", async () => {
    host([{ id: 't1', title: 'Terminal 1' }]);
    const { result } = renderHook(() => useTerminalTabs('ws-1'));

    expect(result.current.active).toBe(AGENT_TAB);
    await waitFor(() => expect(result.current.tabs).toEqual([{ id: 't1', title: 'Terminal 1' }]));
  });

  it('opens a tab in the project and shows it', async () => {
    const { calls } = host();
    const { result } = renderHook(() => useTerminalTabs('ws-2'));

    await act(async () => {
      await result.current.open();
    });

    expect(calls).toContainEqual(['terminal.open', { workspaceId: 'ws-2' }]);
    expect(result.current.tabs.map((t) => t.title)).toEqual(['Terminal 1']);
    expect(result.current.active).toBe('t1');
  });

  it('closes a tab, and goes back to the Agent tab when it was the one shown', async () => {
    const { calls } = host([{ id: 't1', title: 'Terminal 1' }]);
    const { result } = renderHook(() => useTerminalTabs('ws-3'));
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    act(() => result.current.select('t1'));

    await act(async () => {
      await result.current.close('t1');
    });

    expect(calls).toContainEqual(['terminal.close', { tabId: 't1' }]);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.active).toBe(AGENT_TAB);
  });

  it('follows the tabs main reports, and leaves a tab whose shell exited', async () => {
    const { changed } = host([{ id: 't1', title: 'Terminal 1' }]);
    const { result } = renderHook(() => useTerminalTabs('ws-4'));
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    act(() => result.current.select('t1'));

    changed([{ id: 't2', title: 'Terminal 2' }]);

    await waitFor(() => expect(result.current.tabs).toEqual([{ id: 't2', title: 'Terminal 2' }]));
    expect(result.current.active).toBe(AGENT_TAB);
  });

  it('keeps the tab shown when the pane is opened again for the chat', async () => {
    host([{ id: 't1', title: 'Terminal 1' }]);
    const first = renderHook(() => useTerminalTabs('ws-5'));
    await waitFor(() => expect(first.result.current.tabs).toHaveLength(1));
    act(() => first.result.current.select('t1'));
    first.unmount();

    const again = renderHook(() => useTerminalTabs('ws-5'));
    await waitFor(() => expect(again.result.current.tabs).toHaveLength(1));
    expect(again.result.current.active).toBe('t1');
  });
});
