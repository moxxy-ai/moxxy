import { asPluginId } from '@moxxy/sdk';

export const GOAL_MODE_NAME = 'goal';

export const GOAL_PLUGIN_ID = asPluginId('@moxxy/mode-goal');

/**
 * Outer safety cap on how many work→check rounds goal mode will run before
 * giving up. "Work until delivered" must still be bounded so a model that
 * can't actually finish doesn't burn the budget forever. Stops are: objective
 * verified delivered, user interrupt, blocked-on-user, or this cap.
 */
export const GOAL_MAX_ROUNDS = 25;

/**
 * Per-round soft cap on the tool-use sub-loop (mirrors mode-developer's dialed
 * down cap — punchy rounds, the outer round loop provides persistence).
 */
export const GOAL_WORK_MAX_ITERATIONS = 60;

/**
 * Layered on top of any user-supplied system prompt for each WORK round. The
 * point of goal mode is autonomy: do the work, don't stop early, don't ask for
 * permission on routine steps — but DO stop and ask when genuinely blocked on
 * something only the user can provide (a secret, a decision, missing info).
 * The runtime — not the model — runs the completion check between rounds, so
 * the prompt doesn't mention it.
 */
export const GOAL_SYSTEM_PROMPT = `You are working autonomously to FULLY DELIVER an objective for the user. You keep going across multiple rounds until the objective is genuinely met — you are not done just because you produced some output.

Operating rules:
- Do real work with your tools. Make concrete progress every round; don't just describe what you would do.
- Don't stop early and don't ask permission for routine, reversible steps — just do them.
- When you believe the objective is delivered, briefly state what you accomplished and stop. The system will independently verify before ending; if anything is missing you'll be asked to continue.
- ONLY stop to ask the user when you are genuinely blocked on something they alone can resolve — a secret/credential, a product decision, or missing information you cannot obtain yourself. In that case, ask one clear, specific question and stop. Do NOT invent answers or thrash on something you can't resolve.
- If you catch yourself repeating the same failing action, change approach instead of retrying it unchanged.`;

/**
 * Asked AFTER each work round to decide whether to stop or loop again. Mirrors
 * mode-developer's VERIFY_SYSTEM_PROMPT shape: it may run a real check (for code
 * objectives, the project's build/tests) and must answer in a fixed format the
 * runtime parses. Kept separate so it only appears on the check turn.
 */
export const COMPLETION_CHECK_SYSTEM_PROMPT = `You are checking whether the user's original objective has been FULLY delivered. Do this once, then stop.

1. VERIFY: Re-read the objective and inspect the current state to confirm it is actually met — not just attempted. If the objective involves code, run the project's test/typecheck/build command(s) via Bash to confirm (look at package.json scripts, Makefile, Cargo.toml, etc.) — run AT MOST ONE verify command. Don't re-run a command that already passed.

2. REPORT: Reply with EXACTLY this format and nothing else.

If the objective is fully met:
VERDICT: GOAL_MET
SUMMARY: <one or two lines on what was delivered and how you confirmed it>

If anything is still missing or unverified:
VERDICT: GOAL_NOT_MET
REMAINING:
- <specific item still to do>
- <specific item still to do>

Hard rules:
- Be strict: if you cannot confirm a part of the objective, it is GOAL_NOT_MET.
- Do not narrate ("Let me check…"). Run the check, then output the VERDICT block.
- Do not call the same Bash command twice in a row.
- Output nothing after the SUMMARY / REMAINING block.`;
