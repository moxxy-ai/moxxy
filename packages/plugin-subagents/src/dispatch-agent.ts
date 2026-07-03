import {
  defineTool,
  MoxxyError,
  z,
  type AgentDef,
  type SubagentResult,
  type SubagentSpec,
} from '@moxxy/sdk';

/** Upper bound on a single child prompt. Children seed their session with this
 *  verbatim and send it to the provider; an unbounded string at this trust
 *  boundary lets a runaway/injected model fan out N multi-megabyte completions. */
const MAX_PROMPT_CHARS = 20_000;
/** Upper bound on a per-child system-prompt override. */
const MAX_SYSTEM_PROMPT_CHARS = 8_000;
/**
 * Aggregate text budget across the WHOLE batch (sum of every spec's prompt +
 * systemPrompt). The per-field caps bound one child, but 8 specs each at the
 * field ceiling still total ~224K chars, dispatched as 8 *concurrent*
 * completions — a sudden cost/context/memory spike reachable from untrusted
 * model output. This caps the simultaneous fan-out payload below that
 * worst case while staying generously above any real multi-agent call.
 */
const MAX_BATCH_TEXT_CHARS = 60_000;
/** This tool's own name — never re-granted to children by default so a model
 *  can't drive an unbounded recursive fan-out (8^N sessions). */
const DISPATCH_AGENT_TOOL_NAME = 'dispatch_agent';

const agentSpecSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(MAX_PROMPT_CHARS)
    .describe('The task the sub-agent should perform. Phrase as a focused, self-contained request.'),
  agentType: z
    .string()
    .optional()
    .describe(
      'Named agent kind to spawn (e.g. "researcher", "code-reviewer"). Looked ' +
        'up in the agent registry contributed by installed plugins. Omit, or ' +
        'pass "default", for a generic tool-use agent. Unknown types fall back ' +
        'to default — the request never fails over a missing kind. List of ' +
        'currently-registered kinds is visible via the /agents command.',
    ),
  label: z
    .string()
    .max(60)
    .optional()
    .describe('Short label shown in progress events (e.g. "research-deps", "lint-fix-A").'),
  systemPrompt: z
    .string()
    .max(MAX_SYSTEM_PROMPT_CHARS)
    .optional()
    .describe(
      'Override the kind\'s system prompt. Use to set persona, constraints, ' +
        'or hand off upstream artifacts the child needs as context.',
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Model id override; defaults to the kind\'s model, then the parent\'s. ' +
        'Omit unless the user explicitly requested a specific model — do NOT ' +
        'invent model ids. Unknown ids fall back to the parent\'s model with a warning.',
    ),
  mode: z
    .string()
    .optional()
    .describe(
      'Loop strategy override. Valid values: "default", "goal", ' +
        '"research". OMIT for the kind\'s default — do NOT invent names.',
    ),
  allowedTools: z
    .array(z.string())
    .optional()
    .describe('Restrict the child to these tool names. Overrides the kind\'s allowlist if set.'),
});

// NOTE: `maxIterations` is intentionally absent from the model-facing
// schema. Models tend to hallucinate small numbers (4, 5, 10) when
// given a free integer field, which causes legitimate research tasks
// to fail with `loop exceeded maxIterations (4)`. The cap belongs on
// the AgentDef (per-kind, set by the plugin author) or the spawner
// default (50), not on the per-call payload.

export type AgentSpecInput = z.infer<typeof agentSpecSchema>;

export interface DispatchAgentDeps {
  /** Live lookup against the session's agent registry. Closure-bound at
   *  plugin construction so handler reads see fresh state. */
  readonly getAgent: (name: string) => AgentDef | undefined;
  /**
   * Live snapshot of the parent's tool names. When wired, a child that
   * neither the caller nor its kind restricts is defaulted to the parent's
   * tools MINUS `dispatch_agent`, so a model can't drive an unbounded
   * recursive fan-out (8^N concurrent sessions / fork-bomb). Omit (the
   * default) to preserve full unrestricted inheritance — useful for
   * standalone tests/scripts that don't wire a session.
   */
  readonly getToolNames?: () => ReadonlyArray<string>;
}

/** Built-in "default" kind — surfaced when the model omits agentType or
 *  passes an unknown one. Never registered in the AgentRegistry so
 *  plugins can override it cleanly via `replace()` if they want. */
export const DEFAULT_AGENT: AgentDef = {
  name: 'default',
  description:
    'Generic tool-use loop. Inherits the parent\'s full tool registry; no system prompt override.',
};

export function buildDispatchAgentTool(deps: DispatchAgentDeps) {
  return defineTool({
    name: 'dispatch_agent',
    description:
      'Spawn one or more focused sub-agents in parallel. Use when a task fans out ' +
      'into independent subtasks (multi-source research, per-file refactor, ' +
      'multi-perspective review). Each child runs in isolation and returns its ' +
      'final message; children stream their progress so you see what each one is ' +
      'doing in real time. Pass `agentType` to pick a specialized kind from the ' +
      'agent registry (see /agents); omit for the default generic agent. Unknown ' +
      'kinds fall back to the default instead of erroring.',
    inputSchema: z.object({
      agents: z
        .array(agentSpecSchema)
        .min(1)
        .max(8)
        .superRefine((specs, ctx) => {
          // Bound the *aggregate* concurrent fan-out payload, not just each
          // child. Reject the whole batch before any session is spawned.
          let total = 0;
          for (const s of specs) total += s.prompt.length + (s.systemPrompt?.length ?? 0);
          if (total > MAX_BATCH_TEXT_CHARS) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                `dispatch_agent batch payload too large: ${total} chars across ${specs.length} ` +
                `agent(s) exceeds the ${MAX_BATCH_TEXT_CHARS}-char aggregate limit. Spawn fewer ` +
                `agents per call or shorten the prompts/systemPrompts.`,
            });
          }
        })
        .describe('Specs for the agents to spawn. Run in parallel; results returned in order.'),
    }),
    // The handler itself only resolves specs and delegates to the session's
    // subagent spawner (ctx.subagents); each child's provider/tool traffic
    // runs in its own session under its own tools' declarations. No timeMs:
    // a legitimate research batch can run far longer than any fixed bound.
    isolation: { capabilities: { net: { mode: 'none' } } },
    handler: async (input, ctx) => {
      if (!ctx.subagents) {
        throw new MoxxyError({
          code: 'INTERNAL',
          message:
            'dispatch_agent: no subagent spawner available — this tool must be invoked from a run-turn loop.',
          hint: 'Invoke dispatch_agent from within a run-turn loop so the subagent spawner is wired into the tool context.',
        });
      }
      const agents = input.agents as AgentSpecInput[];
      const specs: SubagentSpec[] = agents.map((s, i) =>
        resolveSpec(s, deps, { index: i, total: agents.length }),
      );
      // The core spawner runs children with Promise.all, which rejects on the
      // FIRST child's setup throw (model/log/provider lookup before the
      // per-child try) and discards every sibling's result. Degrade to
      // per-child errors here so one child's failure doesn't abort the batch
      // and orphan the rest — the model still gets the specs that succeeded.
      let results: ReadonlyArray<SubagentResult>;
      try {
        results = await ctx.subagents.spawnAll(specs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          results: specs.map((s) => ({
            label: s.label ?? s.agentType ?? 'default',
            childSessionId: '',
            text: '',
            stopReason: 'error',
            error: message,
          })),
        };
      }
      return {
        results: results.map((r) => ({
          label: r.label,
          childSessionId: String(r.childSessionId),
          text: r.text,
          stopReason: r.stopReason,
          ...(r.error ? { error: r.error.message } : {}),
        })),
      };
    },
  });
}

/** Position of this spec within a multi-agent batch — used to disambiguate
 *  fallback labels and (informationally) reason about fan-out width. */
export interface ResolveSpecPosition {
  readonly index: number;
  readonly total: number;
}

/**
 * Merge a model-supplied spec with the registered agent kind. Caller
 * fields win over kind defaults; omitted caller fields fall back to
 * the kind, which falls back to the built-in DEFAULT.
 */
export function resolveSpec(
  input: AgentSpecInput,
  deps: DispatchAgentDeps,
  position?: ResolveSpecPosition,
): SubagentSpec {
  const requested = input.agentType ?? 'default';
  const def = deps.getAgent(requested) ?? DEFAULT_AGENT;
  const systemPrompt = input.systemPrompt ?? def.systemPrompt;
  const model = input.model ?? def.model;
  const mode = input.mode ?? def.mode;
  // maxIterations only comes from the AgentDef now (the input schema
  // doesn't expose it — see comment in agentSpecSchema above).
  const allowedTools = resolveAllowedTools(input, def, deps);
  // When the caller omits `label`, multiple agents of the same kind would all
  // collapse to the kind's name (e.g. five "default" labels), making the live
  // progress display and the returned results indistinguishable. Suffix a
  // 1-based index in that multi-agent case; keep explicit/single labels clean.
  const fallbackLabel =
    position && position.total > 1 ? `${def.name}-${position.index + 1}` : def.name;
  const merged: SubagentSpec = {
    prompt: input.prompt,
    label: input.label ?? fallbackLabel,
    // The requested kind, surfaced in subagent_* payloads for group rendering.
    agentType: requested,
    ...(systemPrompt !== undefined && { systemPrompt }),
    ...(model !== undefined && { model }),
    ...(mode !== undefined && { mode }),
    ...(def.maxIterations !== undefined && { maxIterations: def.maxIterations }),
    ...(allowedTools !== undefined && { allowedTools }),
  };
  return merged;
}

/**
 * Decide the child's tool allowlist. Caller `allowedTools` wins, then the
 * kind's, then — when a parent tool snapshot is wired (`deps.getToolNames`)
 * and neither restricts — the parent's tools MINUS `dispatch_agent`. That
 * last default is the recursion cut: without it, an unrestricted child
 * inherits `dispatch_agent` and each level can spawn another full batch,
 * giving 8^depth concurrent sessions reachable from untrusted model output.
 * A kind that genuinely needs to recurse can re-grant `dispatch_agent`
 * explicitly via its `allowedTools`.
 */
function resolveAllowedTools(
  input: AgentSpecInput,
  def: AgentDef,
  deps: DispatchAgentDeps,
): ReadonlyArray<string> | undefined {
  const explicit = input.allowedTools ?? def.allowedTools;
  if (explicit !== undefined) return explicit;
  if (!deps.getToolNames) return undefined; // not wired → preserve full inheritance
  return deps.getToolNames().filter((n) => n !== DISPATCH_AGENT_TOOL_NAME);
}
