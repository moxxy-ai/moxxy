/**
 * useTerminalTab: one of the project's own shells, over `terminal.*` (the IPC
 * boundary is the one double): what it printed before the pane attached, then
 * its own output only, and keys and sizes sent back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useTerminalTab } from './useTerminalTab';

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

function host(snapshot: unknown) {
  const calls: Array<[string, unknown]> = [];
  let onData: ((payload: { tabId: string; data: string }) => void) | null = null;
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      return cmd === 'terminal.attach' ? snapshot : undefined;
    },
    subscribe: (event: string, cb: (payload: { tabId: string; data: string }) => void) => {
      if (event === 'terminal.data') onData = cb;
      return () => {
        if (event === 'terminal.data') onData = null;
      };
    },
  } as unknown as MoxxyApi);
  return { calls, data: (payload: { tabId: string; data: string }) => act(() => onData?.(payload)) };
}

describe('useTerminalTab', () => {
  it("writes what the tab printed, then only that tab's output, and sends keys and sizes to it", async () => {
    const { calls, data } = host({ data: 'earlier$ ', backend: 'pty', ptyError: null });
    const written: string[] = [];
    const { result } = renderHook(() => useTerminalTab('t1', { write: (text) => written.push(text) }));

    await waitFor(() => expect(result.current.ready).toBe(true));
    data({ tabId: 't1', data: 'ls\r\n' });
    data({ tabId: 't2', data: 'other tab' });
    result.current.input('pwd\r');
    result.current.resize(100, 30);

    expect(written).toEqual(['earlier$ ', 'ls\r\n']);
    expect(calls).toContainEqual(['terminal.input', { tabId: 't1', data: 'pwd\r' }]);
    expect(calls).toContainEqual(['terminal.resize', { tabId: 't1', cols: 100, rows: 30 }]);
  });

  it('says why a tab is no real terminal, and when it is gone', async () => {
    host({ data: '', backend: 'pipe', ptyError: 'spawn failed' });
    const degraded = renderHook(() => useTerminalTab('t1', { write: () => undefined }));
    await waitFor(() => expect(degraded.result.current.error).toBe('The PTY backend failed to start (spawn failed).'));
    degraded.unmount();

    host(null);
    const gone = renderHook(() => useTerminalTab('t9', { write: () => undefined }));
    await waitFor(() => expect(gone.result.current.error).toBe('This terminal was closed.'));
  });
});
