/**
 * useChat integration test — the first open of a workspace usually races the
 * runner spawn: `chat.loadHistory` returns null (no attached runner yet) and
 * `loadInitial` leaves the slot retryable. Because the runner attaches with
 * `replay:'none'`, nothing pushes history in — so the hook MUST re-run the load
 * once the workspace's runner reaches `connected`. Without that the transcript
 * stays empty until the user re-opens the workspace ("first click empty, second
 * click loads"). Each test uses a unique workspace id so the module-level
 * chat/connection singletons stay isolated.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConnectionSnapshot, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';
import { __setApiOverride } from './transport.js';
import { connectionStore } from './useConnection.js';
import { chatStore } from './chatStore.js';
import { createIpcPersistence } from './chatPersistence.js';
import { useChat } from './useChat.js';

let wsSeq = 0;
function ws(): string {
  wsSeq += 1;
  return `ws-usechat-${wsSeq}`;
}

function userPrompt(text: string): MoxxyEvent {
  return {
    id: `e-${text}`,
    seq: 1,
    ts: 1,
    turnId: 'T1',
    sessionId: 'S',
    source: 'user',
    type: 'user_prompt',
    text,
  } as unknown as MoxxyEvent;
}

function connectedSnapshot(): ConnectionSnapshot {
  return {
    phase: {
      phase: 'connected',
      socket: '/tmp/sock',
      sessionId: 'S',
      activeProvider: null,
      activeMode: null,
    },
    cliPath: null,
    attempts: 0,
    log: [],
  };
}

afterEach(() => {
  __setApiOverride(null);
});

describe('useChat history backfill on runner connect', () => {
  it('re-loads history once the workspace runner reaches connected', async () => {
    const id = ws();
    // The runner is "not connected" until the test flips this — chat.loadHistory
    // returns null in that window, exactly like the IPC handler with no attached
    // supervisor.
    const state = { connected: false };
    let loadCalls = 0;
    const invoke = (async (cmd: string) => {
      if (cmd === 'chat.loadHistory') {
        loadCalls += 1;
        return state.connected ? { events: [userPrompt('hello')], prevCursor: null } : null;
      }
      return undefined;
    }) as unknown as MoxxyApi['invoke'];
    __setApiOverride({ invoke, subscribe: () => () => {} });
    chatStore.setPersistence(createIpcPersistence());

    const { result } = renderHook(() => useChat(id));

    // First open races the spawn: the load runs, returns null, and the
    // transcript shows empty (retryable — slot left unloaded).
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.events).toHaveLength(0);
    const callsBeforeConnect = loadCalls;
    expect(callsBeforeConnect).toBeGreaterThan(0);

    // Runner attaches → connection.changed flips the workspace to connected.
    act(() => {
      state.connected = true;
      connectionStore.setSnapshot(id, connectedSnapshot());
    });

    // The hook re-runs loadInitial and the transcript backfills — no re-open.
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.isEmpty).toBe(false);
    expect(loadCalls).toBeGreaterThan(callsBeforeConnect);
  });

  it('does not re-page once a load has already succeeded (idempotent on reconnect)', async () => {
    const id = ws();
    let loadCalls = 0;
    const invoke = (async (cmd: string) => {
      if (cmd === 'chat.loadHistory') {
        loadCalls += 1;
        return { events: [userPrompt('hi')], prevCursor: null };
      }
      return undefined;
    }) as unknown as MoxxyApi['invoke'];
    __setApiOverride({ invoke, subscribe: () => () => {} });
    chatStore.setPersistence(createIpcPersistence());

    // Already connected at first open.
    connectionStore.setSnapshot(id, connectedSnapshot());
    const { result } = renderHook(() => useChat(id));

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    const callsAfterLoad = loadCalls;

    // A reconnect (connected → reconnecting → connected) must NOT re-page: the
    // window is already loaded (slot.loaded guards re-entry).
    act(() => {
      connectionStore.setSnapshot(id, {
        ...connectedSnapshot(),
        phase: { phase: 'reconnecting', reason: 'drop', attempt: 1 },
      });
    });
    act(() => {
      connectionStore.setSnapshot(id, connectedSnapshot());
    });
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(loadCalls).toBe(callsAfterLoad);
  });
});
