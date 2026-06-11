/**
 * Prompt template for the workflows "Generate with AI" flow — wraps the
 * user's free-text description in an instruction that drives the runner's
 * workflow tools (workflow_create → workflow_get/workflow_validate →
 * workflow_update) with the vault rules baked in.
 */
export const WORKFLOW_PROMPT_TEMPLATE = (description: string): string => `You are
configuring moxxy itself: create a new workflow from the user's description
below, using the workflow tools.

1. Call workflow_create with a clear one-or-two-sentence \`intent\` distilled
   from the description (scope "user" unless the user explicitly asks to
   scope it to this project). It drafts a DAG of steps — kinds: skill |
   prompt | tool | condition | loop — with optional triggers
   (\`on.schedule.cron\`, \`on.fileChanged\`, \`on.afterWorkflow\`,
   \`on.webhook\`; omit triggers for an on-demand workflow). Pick sensible
   step kinds: skill for an installed capability, prompt for free-form agent
   work, tool for one direct tool call, condition/loop only when branching
   or repetition is genuinely needed.
2. Only reference skills and tools that actually exist on this runner —
   check your own available skills/tools (and workflow_list for existing
   workflows) before assuming a name.
3. After creating, fetch the saved YAML with workflow_get and confirm it
   with workflow_validate. If the draft missed something from the
   description, edit the YAML and persist the fix with workflow_update.
4. NEVER embed API keys or other secrets in step args or prompts. If a step
   needs a secret, store it with vault_set and reference it as
   "\${vault:NAME}". If a required secret or an essential detail (e.g. a
   schedule time) is missing, stop and ask instead of guessing.

Finish with a single short line naming the created workflow (plus its
trigger), or a single clear question if you are blocked. No code fences,
no long explanations.

USER DESCRIPTION:
${description}`.trim();
