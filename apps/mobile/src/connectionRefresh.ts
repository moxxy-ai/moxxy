/**
 * Re-primes the client-core connection store from the gateway.
 *
 * `ConnectionBridge` fetches `connection.snapshotAll` / `connection.activeWorkspace`
 * exactly once per client mount with swallowed catches — if that first attempt
 * races a failed dial (the WS client clears its outbox on connect failure) the
 * store keeps a null workspace forever while the socket header says Connected.
 * The moxxy-mobile host also mints a NEW workspace id per runner restart, so a
 * reconnect must re-resolve the active workspace, not just resubscribe. The
 * gateway provider calls this on every successful (re)connect (`refreshTick`).
 */

import { connectionStore } from '@moxxy/client-core';
import type { ConnectionSnapshot, MoxxyApi } from '@moxxy/desktop-ipc-contract';

export interface ConnectionStoreLike {
  setSnapshot(workspaceId: string, snapshot: ConnectionSnapshot): void;
  setActive(workspaceId: string | null): void;
}

export async function refreshConnectionStore(
  transport: Pick<MoxxyApi, 'invoke'>,
  store: ConnectionStoreLike = connectionStore,
): Promise<void> {
  // Independent settle: a failure of one call must not drop the other's result
  // (mirrors ConnectionBridge's per-call catches).
  const [snapshots, active] = await Promise.allSettled([
    transport.invoke('connection.snapshotAll'),
    transport.invoke('connection.activeWorkspace'),
  ]);
  if (snapshots.status === 'fulfilled') {
    for (const { workspaceId, ...snapshot } of snapshots.value) {
      store.setSnapshot(workspaceId, snapshot);
    }
  }
  if (active.status === 'fulfilled') store.setActive(active.value);
}
