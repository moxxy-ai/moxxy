import { defineTool } from '@moxxy/sdk';
import { z } from 'zod';

import { GOAL_ABANDON_TOOL, GOAL_COMPLETE_TOOL } from './constants.js';

/**
 * The goal "utility": two side-effect-free tools the model calls to control the
 * goal loop. They don't DO anything — calling them is the signal. The loop in
 * `goal-loop.ts` watches for their (successful) tool_result and terminates.
 *
 * They're registered globally by the plugin, so they exist in every mode, but
 * only goal mode's system prompt tells the model to use them; elsewhere they're
 * inert. `permission: { action: 'allow' }` means they never trip a permission
 * prompt — declaring done is not a privileged action.
 */

export const goalCompleteTool = defineTool({
  name: GOAL_COMPLETE_TOOL,
  description:
    'Declare the goal FULLY ACHIEVED and end goal mode. Call this only after you have verified the work. ' +
    'Provide a short summary and concrete evidence (commands run + results, files changed, tests that passed). ' +
    'This is the only way to end a goal-mode run successfully.',
  inputSchema: z.object({
    summary: z.string().min(1).describe('One- or two-sentence summary of what was accomplished.'),
    evidence: z
      .array(z.string())
      .optional()
      .describe('Concrete proof the goal is met: commands run and their results, files changed, tests passed.'),
  }),
  permission: { action: 'allow' },
  // Side-effect-free loop signal (see the module comment) — no capabilities.
  isolation: { capabilities: { net: { mode: 'none' }, timeMs: 10_000 } },
  handler: (input) => {
    const { summary, evidence } = input as { summary: string; evidence?: string[] };
    return {
      acknowledged: true,
      summary,
      evidenceCount: evidence?.length ?? 0,
    };
  },
});

export const goalAbandonTool = defineTool({
  name: GOAL_ABANDON_TOOL,
  description:
    'Give up on the goal because you are genuinely blocked — a missing credential, a destructive action you ' +
    'should not take unattended, or a requirement too ambiguous to proceed. Provide the reason and exactly what ' +
    'you need from the user. This ends goal mode without claiming success.',
  inputSchema: z.object({
    reason: z.string().min(1).describe('Why you cannot proceed.'),
    needsFromUser: z
      .string()
      .optional()
      .describe('What the user must provide or decide for the goal to continue.'),
  }),
  permission: { action: 'allow' },
  // Side-effect-free loop signal (see the module comment) — no capabilities.
  isolation: { capabilities: { net: { mode: 'none' }, timeMs: 10_000 } },
  handler: (input) => {
    const { reason, needsFromUser } = input as { reason: string; needsFromUser?: string };
    return { acknowledged: true, reason, ...(needsFromUser ? { needsFromUser } : {}) };
  },
});

export const goalTools = [goalCompleteTool, goalAbandonTool];
