/**
 * Per-process hub client singleton. A peer process (booted by `moxxy agent`)
 * carries the hub socket + its agent id in env; the collab_* tools resolve
 * this one shared client lazily on first use. Outside a collaboration (no env)
 * it resolves to null and the tools no-op with a clear message.
 */

import { CollabHubClient } from './client.js';

export const COLLAB_ENV = {
  Hub: 'MOXXY_COLLAB_HUB',
  AgentId: 'MOXXY_COLLAB_AGENT_ID',
  Role: 'MOXXY_COLLAB_ROLE',
  Subtask: 'MOXXY_COLLAB_SUBTASK',
  ParentTask: 'MOXXY_COLLAB_PARENT_TASK',
  RunnerSocket: 'MOXXY_RUNNER_SOCKET',
  /** Path (never the body) of this agent's architect-authored role charter. */
  CharterFile: 'MOXXY_COLLAB_CHARTER_FILE',
} as const;

let clientPromise: Promise<CollabHubClient | null> | null = null;

/** True when this process was launched as a collaboration peer. */
export function isCollabPeer(): boolean {
  return Boolean(process.env[COLLAB_ENV.Hub]) && Boolean(process.env[COLLAB_ENV.AgentId]);
}

/** Connect (once) to this peer's hub, or null when not running as a peer. */
export function getProcessHubClient(): Promise<CollabHubClient | null> {
  if (clientPromise) return clientPromise;
  const socketPath = process.env[COLLAB_ENV.Hub];
  const agentId = process.env[COLLAB_ENV.AgentId];
  if (!socketPath || !agentId) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }
  const runnerSocket = process.env[COLLAB_ENV.RunnerSocket];
  clientPromise = CollabHubClient.connect(socketPath, agentId, {
    ...(runnerSocket ? { runnerSocket } : {}),
    pid: process.pid,
  }).catch(() => null);
  return clientPromise;
}

/** Test seam: reset the memoized connection. */
export function __resetProcessHubClient(): void {
  clientPromise = null;
}
