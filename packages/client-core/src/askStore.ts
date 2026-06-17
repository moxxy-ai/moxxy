import { useSyncExternalStore } from 'react';
import type { AskRequest, AskResponse } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';

/**
 * Pending interactive asks (permission / approval prompts the runner forwarded
 * via `ask.request`). The runner blocks until each is answered, so they queue;
 * the {@link AskSheet} shows the first one for the active workspace and the
 * next surfaces once it's answered.
 */

let asks: ReadonlyArray<AskRequest> = Object.freeze([]);
const resolvedIds = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const askStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getAll(): ReadonlyArray<AskRequest> {
    return asks;
  },
  add(req: AskRequest): void {
    if (resolvedIds.has(req.requestId)) return;
    if (asks.some((a) => a.requestId === req.requestId)) return;
    asks = Object.freeze([...asks, req]);
    emit();
  },
  resolve(requestId: string): void {
    resolvedIds.add(requestId);
    if (!asks.some((a) => a.requestId === requestId)) return;
    asks = Object.freeze(asks.filter((a) => a.requestId !== requestId));
    emit();
  },
  /**
   * Send the user's decision back to the runner and drop the ask.
   *
   * Drops optimistically (so the sheet advances immediately) but re-inserts
   * the ask if the IPC round-trip fails: the runner blocks parked on the ask
   * until `ask.respond` lands, so silently swallowing a transport/handler
   * failure would strand the turn forever with no way to re-answer.
   */
  respond(requestId: string, response: AskResponse): void {
    const pending = asks.find((a) => a.requestId === requestId);
    if (!pending) return;
    resolvedIds.add(requestId);
    asks = Object.freeze(asks.filter((a) => a.requestId !== requestId));
    emit();
    void api()
      .invoke('ask.respond', { requestId, response })
      .catch((e: unknown) => {
        // Re-surface the ask so the user can retry instead of a wedged turn.
        resolvedIds.delete(requestId);
        if (!asks.some((a) => a.requestId === requestId)) {
          asks = Object.freeze([...asks, pending]);
          emit();
        }
        // Best-effort diagnostic (this package is DOM-/Node-global-free).
        (globalThis as { console?: { error(...args: unknown[]): void } }).console?.error(
          '[askStore] ask.respond failed; re-surfacing ask',
          e,
        );
      });
  },
};

/** Subscribe the store to incoming `ask.request` events. Call once at boot. */
export function wireAskBridge(): () => void {
  const offRequest = api().subscribe('ask.request', (req: AskRequest) => askStore.add(req));
  const offResolved = api().subscribe('ask.resolved', ({ requestId }) => {
    askStore.resolve(requestId);
  });
  return () => {
    offRequest();
    offResolved();
  };
}

/** First pending ask for a workspace, or null. */
export function useActiveAsk(workspaceId: string | null): AskRequest | null {
  const all = useSyncExternalStore(askStore.subscribe, askStore.getAll);
  if (!workspaceId) return null;
  return all.find((a) => a.workspaceId === workspaceId) ?? null;
}
