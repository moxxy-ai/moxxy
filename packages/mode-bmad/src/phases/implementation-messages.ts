import {
  buildSystemPromptWithSkills,
  projectMessages,
  type ModeContext,
  type ProviderMessage,
} from '@moxxy/sdk';

import type { Artifacts } from '../constants.js';

/**
 * Single context block instead of three consecutive assistant messages.
 * Several providers (including codex /responses) handle alternating
 * user/assistant turns much better than 3+ consecutive assistant blocks
 * — the latter was making the codex implementation phase return
 * end_turn with empty text on iteration 1, which the loop was
 * mis-reading as "story complete" and exiting silently.
 */
export function buildBmadContext(artifacts: Artifacts): string {
  return (
    `BMAD context — three prior phases produced these artifacts:\n\n` +
    `## Analyst brief\n${artifacts.analysis}\n\n` +
    `## Story list\n${artifacts.planning}\n\n` +
    `## Architect's design\n${artifacts.solutioning}`
  );
}

export function buildDevNudge(stories: ReadonlyArray<string>): string {
  const storyList = stories.map((s, i) => `  ${i + 1}. [ ] ${s}`).join('\n');
  return (
    `Developer persona. Implement the stories above now using the available ` +
    `tools. Work through them in order; flow between stories as needed. ` +
    `Do not narrate — call the tools. When all acceptance criteria are met, ` +
    `reply with one short summary line and stop.\n\n` +
    `Stories to implement:\n${storyList}`
  );
}

/**
 * Message builder for the implementation phase. Projects the live log via
 * the shared `projectMessages` so the implementation loop gets the same
 * compaction / turn-boundary elision / orphan-tool_use synthesis as every
 * other mode (the previous hand-rolled replay bypassed all three). The
 * BMAD artifacts (analyst brief, stories, architect design) are re-injected
 * as a single context-bearing user turn, followed by the developer nudge,
 * on the first iteration only — on later iterations they're already
 * established and the live conversation carries the work forward. The shape
 * on iteration 1 is:
 *
 *   system   = systemPrompt + skill index
 *   …         projected log (prompt, prior assistant turns, tool calls/results)
 *   user[-2] = BMAD context (analyst brief, stories, design)
 *   user[-1] = developer nudge ("implement these now, use tools")
 */
export function buildImplementationMessages(
  ctx: ModeContext,
  bmadContext: string | null,
  devNudge: string | null,
): ProviderMessage[] {
  const systemText =
    buildSystemPromptWithSkills(ctx.systemPrompt, ctx.skills.list()) ?? ctx.systemPrompt;
  const { messages } = projectMessages(ctx, systemText ? { systemPrompt: systemText } : {});

  // Inject the BMAD context + dev nudge as standalone user turns on the
  // first iteration so the developer persona has the artifacts spelled out
  // and a forceful "use tools now" nudge.
  if (bmadContext) {
    messages.push({ role: 'user', content: [{ type: 'text', text: bmadContext }] });
  }
  if (devNudge) {
    messages.push({ role: 'user', content: [{ type: 'text', text: devNudge }] });
  }
  return messages;
}
