/**
 * Names, ids, and on-disk path helpers for the collaborative mode. Socket and
 * worktree paths are kept short (macOS caps unix socket paths at ~104 chars).
 */

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const COLLAB_MODE_NAME = 'collaborative';
export const COLLAB_ARCHITECT_MODE_NAME = 'collab-architect';
export const COLLAB_PEER_MODE_NAME = 'collab-peer';
export const COLLAB_PLUGIN_ID = '@moxxy/mode-collaborative';

export const ARCHITECT_AGENT_ID = 'architect';

/** Env var carrying the per-peer iteration cap from the coordinator to a spawned
 *  agent (so `config.peerMaxIterations` actually bounds the peer loop). */
export const COLLAB_MAX_ITERATIONS_ENV = 'MOXXY_COLLAB_MAX_ITERATIONS';

/** Scaffold the architect writes into the base repo (committed before forking). */
export const COLLAB_SCAFFOLD_DIR = '.moxxy-collab';
export const CONTRACTS_FILENAME = 'CONTRACTS.md';
/** Architect's machine-readable roster proposal, read by the coordinator. */
export const ROSTER_FILENAME = 'roster.json';
/** Coordinator-written brief: the overall goal + the user's conversation/intent,
 *  so every spawned agent inherits the full picture (not just its subtask). */
export const BRIEF_FILENAME = 'BRIEF.md';

/** A short, filesystem-safe, COLLISION-RESISTANT run id. The session+turn tails
 *  alone collide when two ids share their trailing 6 alnum chars, reusing the
 *  same socket/worktree paths across distinct runs (a stale colliding dir then
 *  breaks integrate()'s `__staging__` worktree add with "already exists"). A short
 *  time+random suffix makes distinct runs never share on-disk paths. Kept short —
 *  macOS caps unix-socket paths at ~104 chars. */
export function collabRunId(sessionId: string, turnId: string): string {
  const tail = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'x';
  const suffix = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(-8);
  return `${tail(sessionId)}-${tail(turnId)}-${suffix}`;
}

/** Per-run directory holding the hub + peer sockets. */
export function collabRunDir(runId: string): string {
  return join(homedir(), '.moxxy', 'collab', runId);
}

export function hubSocketPath(runId: string): string {
  return join(collabRunDir(runId), 'hub.sock');
}

export function peerSocketPath(runId: string, agentId: string): string {
  return join(collabRunDir(runId), `p-${agentId}.sock`);
}

/** Per-run worktree root (kept out of the repo, under the OS temp dir). */
export function worktreeRoot(runId: string): string {
  return join(tmpdir(), 'moxxy-collab', runId);
}

export function worktreePath(runId: string, agentId: string): string {
  return join(worktreeRoot(runId), agentId);
}

export function collabBranch(runId: string, agentId: string): string {
  return `moxxy/collab/${runId}/${agentId}`;
}

export function stagingBranch(runId: string): string {
  return `moxxy/collab/${runId}/merged`;
}
