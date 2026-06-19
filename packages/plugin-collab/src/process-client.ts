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
} as const;

/** Min gap between connect attempts after a failure (avoid hammering a hub that
 *  isn't accepting yet) while still letting a transient failure self-heal. */
const RECONNECT_COOLDOWN_MS = 1000;

/** A live, successful connection (only ever memoized on success). */
let client: CollabHubClient | null = null;
/** An in-flight connect attempt, deduped so concurrent tool calls share it. */
let connecting: Promise<CollabHubClient | null> | null = null;
/** Wall-clock of the last failed connect — gates the cooldown. */
let lastFailureTs = 0;

/** True when this process was launched as a collaboration peer. */
export function isCollabPeer(): boolean {
  return Boolean(process.env[COLLAB_ENV.Hub]) && Boolean(process.env[COLLAB_ENV.AgentId]);
}

/**
 * Connect (lazily) to this peer's hub, or null when not running as a peer.
 *
 * Only a SUCCESSFUL, still-open connection is memoized: a transient connect
 * failure (hub not yet accepting, timeout, EAGAIN) is logged and retried on the
 * next call (after a short cooldown) rather than poisoning the singleton for the
 * whole process. A dropped link is likewise transparently re-established.
 */
export async function getProcessHubClient(): Promise<CollabHubClient | null> {
  // Not a peer → stable null (never retried; the env is absent for the run).
  const socketPath = process.env[COLLAB_ENV.Hub];
  const agentId = process.env[COLLAB_ENV.AgentId];
  if (!socketPath || !agentId) return null;

  // A previously good link that dropped must be discarded so we reconnect.
  if (client && client.isClosed) client = null;
  if (client) return client;

  // Dedupe concurrent attempts.
  if (connecting) return connecting;

  // Back off briefly after a recent failure so a flapping hub isn't hammered;
  // the caller still gets null and can retry on its next cycle.
  if (Date.now() - lastFailureTs < RECONNECT_COOLDOWN_MS) return null;

  const runnerSocket = process.env[COLLAB_ENV.RunnerSocket];
  connecting = CollabHubClient.connect(socketPath, agentId, {
    ...(runnerSocket ? { runnerSocket } : {}),
    pid: process.pid,
  })
    .then((c) => {
      client = c;
      return c;
    })
    .catch((err: unknown) => {
      lastFailureTs = Date.now();
      // Swallowing this entirely (the old behavior) left the agent silently
      // unable to collaborate with no diagnostic trail; surface it once.
      console.warn(
        `[collab] failed to connect to hub at ${socketPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

/** Test seam: reset the memoized connection. */
export function __resetProcessHubClient(): void {
  client = null;
  connecting = null;
  lastFailureTs = 0;
}
