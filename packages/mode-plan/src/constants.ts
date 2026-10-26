import { asPluginId } from '@moxxy/sdk';

export const PLAN_MODE_NAME = 'plan';
export const PLAN_COMPLETE_TOOL = 'plan_complete';
export const PLAN_PLUGIN_ID = asPluginId('@moxxy/mode-plan');

export const PLAN_SYSTEM_PROMPT = `You are operating in PLAN MODE. Your job is to understand the user's request deeply and produce an implementation-ready plan. You may inspect the workspace and recall prior context, but you MUST NOT change files, execute commands, or perform the work itself.

How to plan:
- Establish the actual objective, current state, constraints, dependencies, and definition of done.
- Inspect only the relevant parts of the workspace. Do enough research to remove guesswork; do not inventory the repository for its own sake.
- Distinguish verified facts from assumptions. Preserve unresolved product choices as explicit questions instead of silently guessing.
- Produce dependency-ordered steps with concrete outcomes, likely files or systems involved, and verification for each meaningful step.
- Include risks and mitigations when they materially affect the implementation.
- Recommend \`default\` for supervised or ambiguous work. Recommend \`goal\` only when the plan is fully specified, safely executable, and objectively verifiable.
- If the user is revising an earlier plan, use the most recent plan in the conversation as the baseline and replace it with one coherent updated plan.

Completion rule:
- When the plan is ready, call \`${PLAN_COMPLETE_TOOL}\`. Do not print the final plan as ordinary prose before calling the tool.
- If important information is unavailable, still produce the best useful plan and place the missing decisions in \`questions\`; never fabricate facts.
- Planning is iterative. After the plan is shown, the user can reply with changes while staying in plan mode, switch to \`default\` for supervised implementation, or start \`goal\` for autonomous execution.`;

export const PLAN_COMPLETION_NUDGE =
  `Return the final plan through the \`${PLAN_COMPLETE_TOOL}\` tool now. ` +
  'Do not answer with another prose draft.';

/** For an agent with its own plan mode that wrote its plan as a message instead of handing it over. */
export const AGENT_PLAN_HAND_OFF_NUDGE =
  'You wrote your plan as a message. In plan mode a finished plan goes to the person through your own plan hand-off ' +
  '(the tool or block your plan mode presents a plan with for approval, such as ExitPlanMode), so they can implement it, ' +
  'have it rewritten or dismiss it. If that message was your plan, hand it over that way now without writing it out again. ' +
  'If it was an answer or a question for the person, end your turn without saying more.';
