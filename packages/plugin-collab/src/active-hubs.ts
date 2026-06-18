/**
 * Process-local registry of live hubs, keyed by the coordinator's sessionId.
 * The collaborative mode registers its hub here while a run is in flight; the
 * `collab_say` command (and a future `collab.post` runner RPC) look it up to
 * deliver a human message into the running collaboration. Mirrors the
 * subagent retained-child registry pattern.
 */

import type { CollaborationHub } from './hub.js';

const active = new Map<string, CollaborationHub>();

export function registerActiveHub(sessionId: string, hub: CollaborationHub): void {
  active.set(sessionId, hub);
}

export function getActiveHub(sessionId: string): CollaborationHub | undefined {
  return active.get(sessionId);
}

export function unregisterActiveHub(sessionId: string): void {
  active.delete(sessionId);
}
