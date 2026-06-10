import { describe, expect, it } from 'vitest';
import type { ConnectionSnapshot, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { refreshConnectionStore, type ConnectionStoreLike } from '../connectionRefresh';
import { buildConnectionUi, shouldOfferRepair } from '../socketLifecycle';

// The transport (`WsRpcClient`) owns reconnect/backoff, so the lifecycle
// module reduces to status → UI projection. These tests pin the user-facing
// contract per `WsClientStatus`.
describe('mobile socket lifecycle ui', () => {
  it('keeps the chat quiet while the socket is open', () => {
    expect(buildConnectionUi('open')).toMatchObject({
      tone: 'ok',
      showBanner: false,
      canSend: true,
      shouldOfferRepair: false,
    });
  });

  it('shows a pending banner during initial connect and transport-owned reconnects', () => {
    expect(buildConnectionUi('connecting')).toMatchObject({
      label: 'Connecting...',
      tone: 'pending',
      showBanner: true,
      canSend: false,
    });
    expect(buildConnectionUi('reconnecting')).toMatchObject({
      label: 'Reconnecting...',
      tone: 'pending',
      showBanner: true,
      shouldOfferRepair: false,
    });
  });

  it('offers re-pairing only for the terminal disconnect (reconnect budget exhausted)', () => {
    expect(buildConnectionUi('disconnected')).toMatchObject({
      tone: 'error',
      showBanner: true,
      canSend: false,
      shouldOfferRepair: true,
    });
    expect(shouldOfferRepair('disconnected')).toBe(true);
    expect(shouldOfferRepair('reconnecting')).toBe(false);
    expect(shouldOfferRepair('closed')).toBe(false);
  });

  it('treats a deliberate close as quiet, not an error', () => {
    expect(buildConnectionUi('closed')).toMatchObject({
      tone: 'muted',
      showBanner: false,
      canSend: false,
      shouldOfferRepair: false,
    });
  });
});

// `ConnectionBridge` primes the store once per client mount and never
// retries; the gateway provider re-primes via refreshConnectionStore on
// every refreshTick so a failed first dial / runner restart can't leave the
// app deaf on a stale workspace.
describe('mobile connection store refresh', () => {
  const snapshot: ConnectionSnapshot = {
    phase: { phase: 'connected' } as ConnectionSnapshot['phase'],
    cliPath: null,
    attempts: 0,
    log: [],
  };

  function makeStore() {
    const snapshots: Array<{ workspaceId: string; snapshot: ConnectionSnapshot }> = [];
    const actives: Array<string | null> = [];
    const store: ConnectionStoreLike = {
      setSnapshot: (workspaceId, next) => snapshots.push({ workspaceId, snapshot: next }),
      setActive: (workspaceId) => actives.push(workspaceId),
    };
    return { store, snapshots, actives };
  }

  function makeTransport(handlers: Record<string, () => Promise<unknown>>): Pick<MoxxyApi, 'invoke'> {
    return {
      invoke: ((command: string) => handlers[command]!()) as MoxxyApi['invoke'],
    };
  }

  it('re-primes every workspace snapshot and the active workspace', async () => {
    const { store, snapshots, actives } = makeStore();
    await refreshConnectionStore(
      makeTransport({
        'connection.snapshotAll': async () => [{ workspaceId: 'ws-2', ...snapshot }],
        'connection.activeWorkspace': async () => 'ws-2',
      }),
      store,
    );

    expect(snapshots).toEqual([{ workspaceId: 'ws-2', snapshot }]);
    expect(actives).toEqual(['ws-2']);
  });

  it('still applies the active workspace when snapshotAll fails (and vice versa)', async () => {
    const failing = async () => Promise.reject(new Error('not connected'));

    const first = makeStore();
    await refreshConnectionStore(
      makeTransport({
        'connection.snapshotAll': failing,
        'connection.activeWorkspace': async () => 'ws-1',
      }),
      first.store,
    );
    expect(first.snapshots).toEqual([]);
    expect(first.actives).toEqual(['ws-1']);

    const second = makeStore();
    await refreshConnectionStore(
      makeTransport({
        'connection.snapshotAll': async () => [{ workspaceId: 'ws-1', ...snapshot }],
        'connection.activeWorkspace': failing,
      }),
      second.store,
    );
    expect(second.snapshots).toEqual([{ workspaceId: 'ws-1', snapshot }]);
    expect(second.actives).toEqual([]);
  });
});
