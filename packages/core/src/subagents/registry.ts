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
  /** Cumulative provider token cost across this retained session's turns. */
  tokensUsed?: number;
  /** Wall-clock ms when the entry was (re)registered — drives TTL eviction. */
  readonly retainedAt?: number;
}

/**
 * Cap the number of live retained children. Each entry pins a full EventLog +
 * ModeContext (provider, tool registry, plugin host, signal); an `awaitInput`
 * child whose resume never arrives would otherwise leak for the life of a
 * long-lived in-process runner. When the cap is exceeded the oldest entry is
 * evicted (its `continue()` will then fail with "no retained subagent session").
 */
const MAX_RETAINED = 64;
/** Evict a paused child this long after registration if never resumed. */
const RETAIN_TTL_MS = 30 * 60 * 1000;

const retained = new Map<string, RetainedChildSession>();
/** Child session ids with a `continue()` currently in flight (claim-then-run). */
const busy = new Set<string>();

/** Drop entries past their TTL and return them so the caller can warn. */
function pruneExpired(now: number): RetainedChildSession[] {
  const expired: RetainedChildSession[] = [];
  for (const [id, entry] of retained) {
    if (entry.retainedAt !== undefined && now - entry.retainedAt >= RETAIN_TTL_MS) {
      retained.delete(id);
      expired.push(entry);
    }
  }
  return expired;
}

/**
 * Register (or re-register) a retained child. Returns the entries DROPPED by
 * this call — TTL-expired children plus any evicted to make room under the cap —
 * so the caller can surface a `subagent_warning` for each (a paused `awaitInput`
 * child whose `continue()` will now fail with "no retained subagent session").
 * The registry has no SessionRuntime handle of its own, so it can't emit.
 */
export function registerRetainedChild(session: RetainedChildSession): RetainedChildSession[] {
  const now = Date.now();
  const evicted = pruneExpired(now);
  const id = String(session.childSessionId);
  // Map preserves insertion order, so the first key is the oldest. Evict
  // oldest until we have room for this one (Map.set on an existing id is an
  // update, not an insert, so don't count a re-register against the cap).
  while (retained.size >= MAX_RETAINED && !retained.has(id)) {
    const [oldestId, oldestEntry] = retained.entries().next().value ?? [];
    if (oldestId === undefined) break;
    retained.delete(oldestId);
    if (oldestEntry) evicted.push(oldestEntry);
  }
  retained.set(id, { ...session, retainedAt: now });
  return evicted;
}

export function getRetainedChild(childSessionId: SessionId): RetainedChildSession | undefined {
  return retained.get(String(childSessionId));
}

/**
 * Atomically claim a retained child for a `continue()` turn: remove it from the
 * registry and mark it busy, so a racing `continue()`/`release()` for the same
 * id can't observe the live entry and drive `strategy.run` over the same
 * childLog/childCtx concurrently. Returns `undefined` if the id is unknown or
 * already in flight.
 */
export function claimRetainedChild(childSessionId: SessionId): RetainedChildSession | undefined {
  const id = String(childSessionId);
  if (busy.has(id)) return undefined;
  const entry = retained.get(id);
  if (!entry) return undefined;
  retained.delete(id);
  busy.add(id);
  return entry;
}

/** Release a claim taken by {@link claimRetainedChild} (after the turn settles). */
export function unclaimRetainedChild(childSessionId: SessionId): void {
  busy.delete(String(childSessionId));
}

export function releaseRetainedChild(childSessionId: SessionId): void {
  const id = String(childSessionId);
  retained.delete(id);
  busy.delete(id);
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
    busy.clear();
    return;
  }
  const target = String(parentSessionId);
  for (const [childId, entry] of retained) {
    if (String(entry.parentSession.id) === target) retained.delete(childId);
  }
}
