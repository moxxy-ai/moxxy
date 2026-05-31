import type { CollectedToolUse, MoxxyEvent } from '@moxxy/sdk';

import { GOAL_ABANDON_TOOL, GOAL_COMPLETE_TOOL } from './constants.js';

export type GoalTerminal =
  | { kind: 'complete'; summary: string; evidence: string[] }
  | { kind: 'abandon'; reason: string; needsFromUser?: string }
  | null;

/**
 * Inspect a just-executed batch of tool uses for a terminal goal signal. We
 * confirm against the event log that the goal tool's `tool_result` actually
 * succeeded (`ok: true`) — a hook could in principle have denied the call — so
 * a denied goal_complete doesn't silently end the run. Returns the parsed
 * payload (pulled from the model's tool INPUT, which is what it intended) so
 * the caller can surface a clean summary.
 */
export function detectGoalTerminal(
  log: ReadonlyArray<MoxxyEvent>,
  batch: ReadonlyArray<CollectedToolUse>,
): GoalTerminal {
  // Map callId -> the goal tool use, so we only react to OUR tools.
  const goalCalls = new Map<string, CollectedToolUse>();
  for (const t of batch) {
    if (t.name === GOAL_COMPLETE_TOOL || t.name === GOAL_ABANDON_TOOL) goalCalls.set(t.id, t);
  }
  if (goalCalls.size === 0) return null;

  // Walk the log tail for the most recent successful result of one of those.
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (!e || e.type !== 'tool_result' || !e.ok) continue;
    const call = goalCalls.get(String(e.callId));
    if (!call) continue;
    const input = (call.input ?? {}) as Record<string, unknown>;
    if (call.name === GOAL_COMPLETE_TOOL) {
      return {
        kind: 'complete',
        summary: typeof input.summary === 'string' ? input.summary : 'Goal completed.',
        evidence: Array.isArray(input.evidence) ? (input.evidence as string[]) : [],
      };
    }
    return {
      kind: 'abandon',
      reason: typeof input.reason === 'string' ? input.reason : 'Goal abandoned.',
      ...(typeof input.needsFromUser === 'string' ? { needsFromUser: input.needsFromUser } : {}),
    };
  }
  return null;
}
