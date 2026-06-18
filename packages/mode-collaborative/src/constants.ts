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

/** Scaffold the architect writes into the base repo (committed before forking). */
export const COLLAB_SCAFFOLD_DIR = '.moxxy-collab';
export const CONTRACTS_FILENAME = 'CONTRACTS.md';
/** Architect's machine-readable roster proposal, read by the coordinator. */
export const ROSTER_FILENAME = 'roster.json';
/** Coordinator-written brief: a CONCISE summary (goal + key requirements/
 *  constraints/decisions) every spawned agent reads up front — not the raw
 *  transcript. */
export const BRIEF_FILENAME = 'BRIEF.md';
/** The full conversation, written for ON-DEMAND recall only — never loaded into
 *  an agent's context by default. An agent reads/greps it if it needs a detail
 *  the brief summary omits. */
export const CONVERSATION_FILENAME = 'CONVERSATION.md';

/** A short, filesystem-safe run id from the session + turn ids. */
export function collabRunId(sessionId: string, turnId: string): string {
  const tail = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'x';
  return `${tail(sessionId)}-${tail(turnId)}`;
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
