import type { ModeContext } from '@moxxy/sdk';

import { MAX_REDRAFTS } from './constants.js';

export type QueryGateOutcome =
  | { kind: 'approve' }
  | { kind: 'redraft'; feedback: string | null }
  | { kind: 'cancel' }
  | { kind: 'redraft-cap-exceeded' };

/**
 * Optional approval gate after the query plan is produced. Headless
 * contexts (no resolver) auto-approve. Mirrors mode-plan-execute's
 * approval gate shape — same option ids, same redraft semantics.
 */
export async function runQueryApprovalGate(
  ctx: ModeContext,
  planText: string,
  queryCount: number,
  redraftCount: number,
): Promise<{ outcome: QueryGateOutcome; redraftCount: number }> {
  if (!ctx.approval) return { outcome: { kind: 'approve' }, redraftCount };

  const decision = await ctx.approval.confirm({
    title: 'Query plan ready — review before fan-out',
    body: planText,
    kind: 'deep-research.queries',
    defaultOptionId: 'approve',
    options: [
      {
        id: 'approve',
        label: 'Approve and fan out',
        hotkey: 'a',
        description: `Spawn ${queryCount} parallel subagent${queryCount === 1 ? '' : 's'} to research these.`,
      },
      {
        id: 'redraft',
        label: 'Redraft with feedback',
        hotkey: 'r',
        requestsText: true,
        textPrompt: 'What should change about the query plan?',
        description: 'Send feedback to the planner and get a new query plan.',
      },
      {
        id: 'cancel',
        label: 'Cancel this turn',
        hotkey: 'c',
        danger: true,
      },
    ],
  });

  if (decision.optionId === 'cancel') return { outcome: { kind: 'cancel' }, redraftCount };
  if (decision.optionId === 'redraft') {
    const nextCount = redraftCount + 1;
    if (nextCount > MAX_REDRAFTS) {
      return { outcome: { kind: 'redraft-cap-exceeded' }, redraftCount: nextCount };
    }
    return {
      outcome: { kind: 'redraft', feedback: decision.text ?? null },
      redraftCount: nextCount,
    };
  }
  return { outcome: { kind: 'approve' }, redraftCount };
}

export type SynthesisGateOutcome =
  | { kind: 'synthesize' }
  | { kind: 'cancel' };

/**
 * Approval gate shown after fan-out, before the synthesis turn. Body is
 * a short digest of each subagent's result so the user can sanity-check
 * coverage before paying for synthesis tokens.
 */
export async function runSynthesisApprovalGate(
  ctx: ModeContext,
  digest: string,
): Promise<SynthesisGateOutcome> {
  if (!ctx.approval) return { kind: 'synthesize' };

  const decision = await ctx.approval.confirm({
    title: 'Fan-out complete — synthesize the final writeup?',
    body: digest,
    kind: 'deep-research.synthesis',
    defaultOptionId: 'synthesize',
    options: [
      {
        id: 'synthesize',
        label: 'Synthesize',
        hotkey: 's',
        description: 'Combine the findings into the final writeup.',
      },
      {
        id: 'cancel',
        label: 'Cancel this turn',
        hotkey: 'c',
        danger: true,
      },
    ],
  });

  if (decision.optionId === 'cancel') return { kind: 'cancel' };
  return { kind: 'synthesize' };
}
