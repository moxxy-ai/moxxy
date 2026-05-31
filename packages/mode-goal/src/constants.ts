import { asPluginId } from '@moxxy/sdk';

export const GOAL_MODE_NAME = 'goal';
export const GOAL_PLUGIN_ID = asPluginId('@moxxy/mode-goal');

/** Tool the model MUST call to declare the goal achieved (the terminator). */
export const GOAL_COMPLETE_TOOL = 'goal_complete';
/** Tool the model calls to give up gracefully (blocked, needs the user). */
export const GOAL_ABANDON_TOOL = 'goal_abandon';

/**
 * Hard cap on autonomous iterations. Goal mode keeps re-prompting the model to
 * continue until it calls {@link GOAL_COMPLETE_TOOL}; this is the backstop that
 * guarantees the loop terminates even if the model never declares done. High
 * enough for a substantial multi-step task, low enough to bound a runaway.
 */
export const GOAL_MAX_ITERATIONS = 150;

/**
 * Consecutive iterations where the model emits NO tool calls and hasn't
 * completed. After this many we stop (a stall) rather than spin forever
 * nudging a model that has decided it's done without saying so.
 */
export const GOAL_MAX_NOOP_ITERATIONS = 3;

/**
 * Cumulative token ceiling (input + output across the whole goal run). A second
 * backstop alongside the iteration cap — a few long-context iterations can burn
 * a lot of tokens even under the iteration limit. Generous; the iteration cap
 * is usually the binding guard.
 */
export const GOAL_TOKEN_BUDGET = 4_000_000;

/**
 * Layered on top of any user system prompt for the whole goal run. The framing
 * is the inverse of normal chat: stopping is NOT the signal to end — the model
 * keeps going until it explicitly calls goal_complete. It runs unattended with
 * tool calls auto-approved, so it must be conservative about irreversible
 * actions and decisive about declaring done.
 */
export const GOAL_SYSTEM_PROMPT = `You are operating in GOAL MODE. The user has given you a goal and you will work on it AUTONOMOUSLY, across as many steps as it takes, until it is genuinely done. You are running unattended — the user is not watching each step and your tool calls are auto-approved — so act like a careful senior engineer who has been handed the keys.

How goal mode ends — this is the most important rule:
- The loop does NOT end when you stop talking. It ends ONLY when you call the \`${GOAL_COMPLETE_TOOL}\` tool. If you produce a message without tool calls, you will simply be prompted to continue.
- When (and only when) the goal is FULLY achieved AND you have verified it, call \`${GOAL_COMPLETE_TOOL}\` with a short summary and concrete evidence (commands you ran and their results, files you changed, tests that passed).
- If you become genuinely blocked — a missing credential, a destructive action you shouldn't take unattended, or a requirement too ambiguous to proceed on — call \`${GOAL_ABANDON_TOOL}\` with the reason and exactly what you need from the user. Do NOT spin on something you cannot resolve.

While working:
- Break the goal into steps and just do them — don't stop to ask for confirmation on routine work; you have autonomy for this run.
- Verify your work as you go (run the project's tests / build / linter when relevant) before declaring the goal complete.
- Be careful with irreversible or destructive operations (deleting data, force-pushing, external side effects). When something is high-stakes and reversible-only-by-the-user, prefer to \`${GOAL_ABANDON_TOOL}\` and ask rather than guess.
- Don't repeat the same failing action. If an approach isn't working, change it; if nothing works, abandon with a clear explanation.
- Don't declare the goal complete prematurely. "I think this should work" is not done — verify first.`;

/** Trailing nudge appended when the model idles (no tool calls) without
 *  completing — reminds it the loop only ends via the completion tool. */
export const CONTINUE_NUDGE =
  `You stopped without calling \`${GOAL_COMPLETE_TOOL}\`. If the goal is fully achieved AND verified, ` +
  `call \`${GOAL_COMPLETE_TOOL}\` now. Otherwise, take the next concrete step toward it.`;

/** Sharper nudge once the model has idled repeatedly. */
export const STALL_NUDGE =
  `You have produced no tool calls for several turns. Either take a concrete next action toward the goal, ` +
  `or call \`${GOAL_COMPLETE_TOOL}\` (if done) / \`${GOAL_ABANDON_TOOL}\` (if blocked). Do not reply with only text again.`;
