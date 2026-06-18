/**
 * Retained-child session registry — backs the `awaitInput` pause/resume flow.
 *
 * A subagent spawned with `retainSession: true` keeps its `EventLog` and
 * `ModeContext` alive after its first turn so a later `continue()` can append
 * an operator reply and run it again. The registry is a process-local map
 * keyed by child session id; entries are dropped on `continue` or `release`.
 *
 * Each entry records its `parentSession`, so {@link clearRetainedChildren}
 * drops only the children belonging to the session that is closing. The map is
 * process-wide (one per module), but a `Session.close()` must NOT wipe another
 * live session's paused children — that would break their `continue()` in any
 * host that runs >1 Session per process (the desktop in-process path, tests).
 */

import type { ModeContext, SessionId, SubagentSpec, TurnId } from '@moxxy/sdk';
import type { EventLog } from '../events/log.js';
import type { SessionRuntime } from '../session-runtime.js';

export interface RetainedChildSession {
  readonly label: string;
  readonly childSessionId: SessionId;
  readonly childTurnId: TurnId;
  readonly childLog: EventLog;
  readonly childCtx: ModeContext;
  readonly spec: SubagentSpec;
  readonly strategy: ReturnType<SessionRuntime['modes']['list']>[number];
  readonly strategyName: string;
  readonly parentSession: SessionRuntime;
  readonly parentTurnId: TurnId;
}

const retained = new Map<string, RetainedChildSession>();

export function registerRetainedChild(session: RetainedChildSession): void {
  retained.set(String(session.childSessionId), session);
}

export function getRetainedChild(childSessionId: SessionId): RetainedChildSession | undefined {
  return retained.get(String(childSessionId));
}

export function releaseRetainedChild(childSessionId: SessionId): void {
  retained.delete(String(childSessionId));
}

/**
 * Drop retained children. With a `parentSessionId`, drop ONLY the children
 * whose `parentSession` is that session — so one session's `close()` can't wipe
 * another live session's paused `awaitInput` children. Without an id (legacy /
 * test-teardown callers), clear everything.
 */
export function clearRetainedChildren(parentSessionId?: SessionId): void {
  if (parentSessionId === undefined) {
    retained.clear();
    return;
  }
  const target = String(parentSessionId);
  for (const [childId, entry] of retained) {
    if (String(entry.parentSession.id) === target) retained.delete(childId);
  }
}
