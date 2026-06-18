import type { LLMProvider } from '@moxxy/sdk';
import { parseWorkflowYaml, type WorkflowParseResult } from './schema.js';

/**
 * Draft a workflow YAML from a natural-language intent — the agentic
 * authoring path behind `workflow_create`. Mirrors `draftSkill`: stream the
 * active provider, extract the YAML block, validate it against the schema.
 */

export interface DraftCatalogEntry {
  readonly name: string;
  readonly description: string;
}

export interface DraftWorkflowOptions {
  readonly availableSkills?: ReadonlyArray<DraftCatalogEntry>;
  readonly availableTools?: ReadonlyArray<DraftCatalogEntry>;
  readonly maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4096;

export function buildSystemPrompt(opts: DraftWorkflowOptions): string {
  const skills = formatCatalog(
    opts.availableSkills,
    '(none registered — use `prompt` steps with clear instructions)',
  );
  const tools = formatCatalog(opts.availableTools, '(none — use `delivery: { channel: inbox }` for notifications)');
  return `You are a workflow author for the "moxxy" agent. Output ONLY a YAML document (optionally inside a \`\`\`yaml fence) — no prose before or after.

A workflow is a DAG of steps. Schema:
- name: kebab-case slug (lowercase letters/numbers/hyphens, starts with a letter)
- description: one clear sentence matching the user's goal (never "A simple Moxxy workflow.")
- enabled: true
- on (optional triggers): { schedule: { cron: "m h dom mon dow", timeZone? }, afterWorkflow?, fileChanged?, webhook? }
- inputs (optional): { <name>: { default: <value>, description: "..." } } — use for values the operator supplies at run time (e.g. recipient email, image brief)
- delivery (optional): { channel?: "inbox", inbox?: true }
- steps: array of steps, each with:
    - id: slug, unique
    - label: short human title (match the user's language when possible)
    - EXACTLY ONE action: skill | prompt | tool | workflow | bridge | condition | switch | loop
    - bridge: instruction — logic step; agent returns JSON with vars (extract/transform data); optional format: plain
    - condition: instruction + then: [step ids] + else: [step ids] — agent returns JSON branch then|else
    - switch: instruction + cases: { <caseId>: [step ids], ... } + optional default: [step ids] — agent returns JSON branch matching a case id
    - loop: { body: [step ids], condition: "<prompt>", maxIterations: 1..50 } — repeats body in order each iteration. \`condition\` is the loop's EXIT/GOAL condition: after each iteration the agent returns JSON branch then (condition met → STOP, continue to the next step) | else (not yet met → run body again). A body step error BREAKS the loop to the next step (use onError: continue on a body step to swallow its error and keep iterating). Always stops at maxIterations (default 10). Body step ids must be real steps; do NOT combine loop with then/else/cases/default.
    - input: templated instruction for skill steps
    - prompt: templated instruction for prompt steps (multiline allowed with |)
    - args: templated args object for tool/workflow steps
    - needs: [ <upstream step ids> ]  (defines the DAG; omit only for true sources)
    - when (optional, legacy): simple guards only — '{{ steps.x.output }} is not empty'. Do NOT use when for semantic decisions (use condition/switch).
    - onError (optional): fail | continue | retry ; retries (optional, 0-3 — only applies when onError is retry; fail/continue always run exactly one attempt)

Operator data — two ways: declare a value the operator can supply UP FRONT as an \`inputs\` field (filled in before Run). To PAUSE mid-run and ask a question whose answer depends on earlier steps, set \`awaitInput: true\` on a prompt or skill step: the workflow pauses, surfaces the step's prompt to the operator, and resumes with their reply once they answer. Prefer \`inputs\` for known-up-front values; use \`awaitInput\` only for genuinely mid-run questions.

Templating: {{ steps.<id>.output }}, {{ inputs.<name> }}, {{ vars.<name> }}, {{ trigger }}, {{ now }}.

Logic steps: default response is one JSON object (vars, branch, optional text). Describe semantics in the instruction; do not repeat JSON syntax unless needed.

Ordering: steps whose \`needs\` are all satisfied run in parallel — chain with \`needs\` for sequential pipelines. A loop's body steps run only inside the loop (each iteration), so give them \`needs: [<loop step id>]\` and never schedule them elsewhere. A loop body step runs unconditionally each iteration: do NOT put \`when\` on it, do NOT make it a condition/switch step, and only \`needs\` its loop step or a sibling body step of the same loop. No NON-loop step may \`needs\` a loop body step — depend on the loop step instead.

Authoring rules:
1. Decompose the intent into concrete steps. Multi-phase requests (collect → act → summarize → deliver) need at least 4 steps with a linear or fan-in \`needs\` chain.
2. Values the operator must supply (search topic, recipient email, brief): declare each as an \`inputs\` field with a clear \`description\` (and a \`default\` when sensible). The operator fills them in before Run; reference them downstream via \`{{ inputs.<name> }}\`.
3. To ask the operator a mid-run question whose answer depends on earlier steps, set \`awaitInput: true\` on a prompt or skill step — the run pauses, shows that step's prompt to the operator, and continues with their reply (referenced downstream via \`{{ steps.<id>.output }}\`). awaitInput is ONLY valid on prompt/skill steps (never tool/logic/loop or a loop body). Prefer \`inputs\` for values known before Run.
4. Research + report + email intents: typical chain — \`web-research\` skill (over \`{{ inputs.topic }}\`) → \`write_report\` → \`send_email\` tool (to \`{{ inputs.recipient }}\`). Put \`topic\` and \`recipient\` in \`inputs\`.
5. Use ONLY skill/tool names from the catalogs below — never placeholders like "<< skill-name >>", "TBD", or empty skill/tool fields.
6. Prefer a listed skill when its description fits; otherwise use a detailed \`prompt\` step.
7. For email/notify: use a listed mail/MCP tool if available; else \`delivery: { channel: inbox }\`.
8. For image generation: use a listed image/generation tool if available; else a \`prompt\` step that describes producing the image artifact in text.
9. Later steps must read prior results via \`{{ steps.<id>.output }}\`, extracted fields via \`{{ vars.<name> }}\`, and operator data via \`{{ inputs.<name> }}\` — never invent example emails or briefs in prompts.
10. Between incompatible steps insert \`bridge\` to extract fields into vars (e.g. an email address from text). Use \`condition\` for if/else routing, \`switch\` for multi-way (e.g. value > 100 → pies, < 0 → kot, else nieokreslony).
11. Use \`loop\` for "keep refining until good enough" / "retry up to N times" / "iterate while X holds" intents — set a sane maxIterations so it always terminates. Prefer bridge + vars over passing raw output to tools.

Available skills (name — description):
${skills}

Available tools (name — description):
${tools}

Example shape for internet research → report → email (operator data via inputs):
\`\`\`yaml
name: internet-research-report-email
description: Research a topic, write a report, and email it to the recipient.
enabled: true
inputs:
  topic:
    description: Temat/zakres wyszukiwania w internecie.
  recipient:
    description: Adres e-mail odbiorcy raportu.
steps:
  - id: search_web
    label: Wyszukaj w internecie
    skill: web-research
    input: |
      Przeprowadź research na temat:
      {{ inputs.topic }}
  - id: write_report
    needs: [search_web]
    label: Przygotuj raport
    prompt: |
      Napisz raport po polsku z wyników researchu.
      Temat: {{ inputs.topic }}
      Research: {{ steps.search_web.output }}
  - id: send_email
    needs: [write_report]
    label: Wyślij e-mail
    tool: gmail_send
    args:
      to: ["{{ inputs.recipient }}"]
      subject: "Raport z researchu"
      body: "{{ steps.write_report.output }}"
\`\`\`

Example shape for image brief → generate → report → email (operator data via inputs):
\`\`\`yaml
name: image-report-email
description: Generate an image from a brief, write a report, and email it.
enabled: true
inputs:
  brief:
    description: What image to generate (subject, style, format, mood, colors).
  recipient:
    description: Recipient email for the report.
steps:
  - id: generate_image
    label: Generate image
    prompt: |
      Generate the image from this brief:
      {{ inputs.brief }}
      Return the artifact path or id and short generation notes.
  - id: write_report
    needs: [generate_image]
    label: Write report
    prompt: |
      Write a concise report in the operator's language.
      Brief: {{ inputs.brief }}
      Generation: {{ steps.generate_image.output }}
  - id: send_report
    needs: [write_report]
    label: Send report
    tool: gmail_send
    args:
      to: ["{{ inputs.recipient }}"]
      subject: "Image workflow report"
      body: "{{ steps.write_report.output }}"
\`\`\`

Example shape for an iterative refine-until-good loop:
\`\`\`yaml
name: refine-draft
description: Draft a paragraph, then refine it until it is good enough or 5 tries are used.
enabled: true
inputs:
  topic:
    default: "release notes"
steps:
  - id: first_draft
    label: First draft
    prompt: |
      Write a first draft about {{ inputs.topic }}.
  - id: refine
    needs: [first_draft]
    label: Refine loop
    loop:
      # condition is the EXIT/GOAL condition — describe the goal that ENDS the
      # loop. Met (then) → stop and continue to the next step; not met (else) →
      # run the body again. A body step error breaks the loop to the next step.
      body: [improve]
      condition: |
        Is the latest draft in {{ vars.draft }} good enough — clear, accurate, and well-structured?
        If yes, the goal is reached and the loop stops; if not, keep refining.
      maxIterations: 5
  - id: improve
    needs: [refine]
    label: Improve draft
    bridge: |
      Improve the current draft (start from {{ steps.first_draft.output }} or {{ vars.draft }}).
      Return JSON with vars.draft set to the improved text.
\`\`\`

Example shape for a mid-run question (awaitInput pause → operator reply → continue):
\`\`\`yaml
name: draft-with-approval
description: Draft an announcement, ask the operator to approve or tweak it, then publish.
enabled: true
steps:
  - id: draft
    label: Draft announcement
    prompt: |
      Write a short product announcement.
  - id: approve
    needs: [draft]
    label: Approve or tweak
    awaitInput: true
    prompt: |
      Here is the draft announcement:
      {{ steps.draft.output }}
      Reply with "ship it" to approve, or describe any changes you want.
  - id: publish
    needs: [approve]
    label: Publish
    prompt: |
      Apply the operator's decision ({{ steps.approve.output }}) and produce the final announcement.
\`\`\`
(Replace skill/tool names with ones from the catalog when drafting.)`;
}

function formatCatalog(
  entries: ReadonlyArray<DraftCatalogEntry> | undefined,
  emptyLabel: string,
): string {
  if (!entries?.length) return emptyLabel;
  return entries
    .map((entry) => `- ${entry.name}${entry.description ? ` — ${entry.description}` : ''}`)
    .join('\n');
}

export interface DraftedWorkflow {
  readonly raw: string;
  readonly parse: WorkflowParseResult;
  /** True when the stream stopped at the output-token cap — the YAML is likely cut off. */
  readonly truncated: boolean;
}

export async function draftWorkflow(
  provider: LLMProvider,
  model: string,
  intent: string,
  signal: AbortSignal,
  opts: DraftWorkflowOptions = {},
): Promise<DraftedWorkflow> {
  let accumulated = '';
  let truncated = false;
  // Clamp the draft budget to the model's own output ceiling — passing more
  // than the model allows is a provider-side 400 (e.g. anthropic rejects
  // max_tokens above the catalog cap).
  const ceiling = provider.models.find((m) => m.id === model)?.maxOutputTokens;
  const budget = Math.min(opts.maxTokens ?? DEFAULT_MAX_TOKENS, ceiling ?? Number.POSITIVE_INFINITY);
  for await (const event of provider.stream({
    model,
    system: buildSystemPrompt(opts),
    messages: [{ role: 'user', content: [{ type: 'text', text: `Build a workflow for: ${intent}` }] }],
    maxTokens: budget,
    signal,
  })) {
    if (event.type === 'text_delta') accumulated += event.delta;
    if (event.type === 'message_end') truncated = event.stopReason === 'max_tokens';
    if (event.type === 'error') throw new Error(`workflow_create: provider error: ${event.message}`);
  }
  const raw = extractYamlBlock(accumulated);
  return { raw, parse: parseWorkflowYaml(raw), truncated };
}

function extractYamlBlock(s: string): string {
  const fence = /```(?:ya?ml)?\n([\s\S]*?)```/.exec(s);
  return (fence ? fence[1]! : s).trim();
}
