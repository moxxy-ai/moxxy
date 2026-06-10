import type { Workflow } from '@moxxy/sdk';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { validateCondition } from './template.js';

/**
 * Validation for workflow artifacts. The SDK owns the structural TS types
 * ({@link Workflow} et al.); this module owns the zod schema that parses
 * on-disk YAML into them, plus the DAG-integrity checks (unique ids, edges
 * reference real steps, no cycles, exactly one action per step).
 */

const ACTION_KEYS = [
  'skill',
  'prompt',
  'tool',
  'workflow',
  'bridge',
  'condition',
  'switch',
  'loop',
] as const;

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
const STEP_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// A bounded while-loop. `condition` is the loop's EXIT/GOAL condition: the body
// repeats UNTIL it is met (then = met → stop & continue to the next step; else =
// not yet → run the body again). `maxIterations` (1..50, default 10) always
// terminates the loop. A body step error breaks the loop to the next step
// (unless that step sets `onError: continue`, which keeps iterating).
const loopActionSchema = z.object({
  body: z.array(z.string().min(1)).min(1),
  condition: z.string().min(1),
  maxIterations: z.number().int().min(1).max(50).default(10),
});

const stepSchema = z
  .object({
    id: z.string().min(1).max(80).regex(STEP_ID_RE, 'step id must be slug-like'),
    skill: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    tool: z.string().min(1).optional(),
    workflow: z.string().min(1).optional(),
    bridge: z.string().min(1).optional(),
    condition: z.string().min(1).optional(),
    then: z.array(z.string().min(1)).optional(),
    else: z.array(z.string().min(1)).optional(),
    switch: z.string().min(1).optional(),
    cases: z.record(z.array(z.string().min(1))).optional(),
    default: z.array(z.string().min(1)).optional(),
    loop: loopActionSchema.optional(),
    input: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    needs: z.array(z.string().min(1)).default([]),
    when: z.string().min(1).optional(),
    onError: z.enum(['fail', 'continue', 'retry']).default('fail'),
    retries: z.number().int().min(0).max(3).default(0),
    label: z.string().max(60).optional(),
    format: z.enum(['json', 'plain']).optional(),
    awaitInput: z.boolean().optional(),
  })
  .superRefine((step, ctx) => {
    // awaitInput pauses a prompt/skill step to ask the operator a question, then
    // resumes with their reply (the human-in-the-loop flow — `workflow.resume`
    // RPC + operator reply UI). It is only meaningful on the step kinds that
    // spawn a child agent (prompt | skill); tool/workflow/logic steps have no
    // interactive child to feed the reply into, and a loop body can't pause
    // mid-iteration (see the loop-body refinement below). Reject it elsewhere so
    // the author picks a supported action rather than hitting a runtime failure.
    const isLogic = step.bridge != null || step.condition != null || step.switch != null;
    if (step.awaitInput && (step.tool != null || step.workflow != null || step.loop != null || isLogic)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": awaitInput is only allowed on prompt or skill steps`,
        path: ['awaitInput'],
      });
    }
    if (step.format === 'plain' && step.bridge == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": format plain is only allowed on bridge steps`,
        path: ['format'],
      });
    }
    if (step.condition != null) {
      if (step.then == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}": condition requires then`,
          path: ['then'],
        });
      }
      if (step.else == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}": condition requires else`,
          path: ['else'],
        });
      }
    }
    if (step.switch != null) {
      const caseKeys = Object.keys(step.cases ?? {});
      if (caseKeys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}": switch requires at least one case`,
          path: ['cases'],
        });
      }
    }
    // A loop owns its own branching (body + LLM predicate); mixing it with the
    // condition/switch branch fields is ambiguous, so reject the combination.
    if (step.loop != null && (step.then != null || step.else != null || step.cases != null || step.default != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": loop cannot be combined with then/else/cases/default`,
        path: ['loop'],
      });
    }
    if (step.then != null && step.condition == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": then is only valid with condition`,
        path: ['then'],
      });
    }
    if (step.else != null && step.condition == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": else is only valid with condition`,
        path: ['else'],
      });
    }
    if (step.cases != null && step.switch == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": cases is only valid with switch`,
        path: ['cases'],
      });
    }
    if (step.default != null && step.switch == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}": default branch list is only valid with switch`,
        path: ['default'],
      });
    }
    const present = ACTION_KEYS.filter((k) => step[k] != null);
    if (present.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}" needs exactly one action (${ACTION_KEYS.join(' | ')})`,
        path: ['skill'],
      });
    } else if (present.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step "${step.id}" has multiple actions (${present.join(', ')}); pick one`,
        path: [present[1]!],
      });
    }
  });

const triggerSchema = z
  .object({
    schedule: z
      .object({
        cron: z.string().optional(),
        runAt: z.union([z.number().int(), z.string()]).optional(),
        timeZone: z.string().optional(),
      })
      .optional(),
    afterWorkflow: z.union([z.string(), z.array(z.string())]).optional(),
    fileChanged: z.union([z.string(), z.array(z.string())]).optional(),
    webhook: z.string().optional(),
  })
  .partial();

const inputSpecSchema = z.object({
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const uiLayoutSchema = z.object({
  nodes: z
    .record(
      z.object({
        x: z.number(),
        y: z.number(),
      }),
    )
    .default({}),
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number().positive(),
    })
    .optional(),
});

export const workflowSchema = z
  .object({
    name: z.string().min(1).max(120).regex(SLUG_RE, 'name must be slug-like'),
    description: z.string().min(1),
    version: z.number().int().default(1),
    enabled: z.boolean().default(true),
    inputs: z.record(inputSpecSchema).default({}),
    on: triggerSchema.optional(),
    delivery: z
      .object({
        channel: z.string().optional(),
        inbox: z.boolean().default(true),
      })
      .optional(),
    ui: z
      .object({
        layout: uiLayoutSchema.optional(),
      })
      .optional(),
    concurrency: z.number().int().min(1).max(8).default(4),
    steps: z.array(stepSchema).min(1).max(40),
  })
  .superRefine((wf, ctx) => {
    const ids = new Set<string>();
    for (const step of wf.steps) {
      if (ids.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate step id "${step.id}"`,
          path: ['steps'],
        });
      }
      ids.add(step.id);
    }
    for (const step of wf.steps) {
      for (const dep of step.needs) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}" needs unknown step "${dep}"`,
            path: ['steps'],
          });
        }
      }
    }
    const cycle = findCycle(wf.steps);
    if (cycle) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `steps form a cycle: ${cycle.join(' → ')}`,
        path: ['steps'],
      });
    }
    for (const step of wf.steps) {
      if (step.when == null) continue;
      const err = validateCondition(step.when);
      if (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}" has an invalid \`when\` condition: ${err}`,
          path: ['steps'],
        });
      }
    }
    for (const step of wf.steps) {
      const branchIds: string[] = [];
      if (step.then) branchIds.push(...step.then);
      if (step.else) branchIds.push(...step.else);
      if (step.cases) for (const list of Object.values(step.cases)) branchIds.push(...list);
      if (step.default) branchIds.push(...step.default);
      for (const ref of branchIds) {
        if (!ids.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}" references unknown branch step "${ref}"`,
            path: ['steps'],
          });
        }
        if (ref === step.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}" cannot reference itself in then/else/cases/default`,
            path: ['steps'],
          });
        }
      }
    }
    // Loop body ids must resolve to real steps (DAG-level check, like branch
    // refs). A loop body step that points nowhere is a workflow-author error.
    for (const step of wf.steps) {
      if (step.loop == null) continue;
      for (const ref of step.loop.body) {
        if (!ids.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}" loop references unknown body step "${ref}"`,
            path: ['steps'],
          });
        }
      }
    }

    // --- loop-body integrity -------------------------------------------------
    // Map every body step id to its owning loop step id. The body steps are
    // run by their loop each iteration and are excluded from the main DAG
    // scheduler (`loopBodyIds`), so several edges around them are unsafe.
    const stepById = new Map(wf.steps.map((s) => [s.id, s]));
    const bodyOwner = new Map<string, string>();
    for (const step of wf.steps) {
      if (step.loop == null) continue;
      for (const ref of step.loop.body) bodyOwner.set(ref, step.id);
    }

    for (const step of wf.steps) {
      const owner = bodyOwner.get(step.id);
      if (owner == null) continue;
      const body = stepById.get(step.id)!;

      // FINDING 3: a condition/switch used AS a loop body has its branch
      // routing (then/else/cases) silently ignored — runLoopStep runs the body
      // step but never applies its branch skips. Reject it so the author picks
      // a supported body action.
      if (body.condition != null || body.switch != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `step "${step.id}" is a loop body of "${owner}" and cannot be a condition/switch ` +
            `step — branch routing is not honored inside a loop body. Use a bridge step to set ` +
            `vars and drive the loop's own exit condition instead.`,
          path: ['steps'],
        });
      }

      // A loop body cannot `awaitInput`: pausing mid-iteration would require
      // checkpointing the loop's iteration state, which the executor does not
      // support (runLoopStep fails loudly on a paused body). Reject it at author
      // time so the author moves the question out of the loop.
      if (body.awaitInput) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `step "${step.id}" is a loop body of "${owner}" and cannot use awaitInput — ` +
            `a loop body cannot pause mid-iteration. Ask the operator before/after the loop instead.`,
          path: ['steps'],
        });
      }

      // FINDING 8: a loop body step runs unconditionally every iteration — its
      // own `when` guard and any `needs` other than the owning loop step are
      // ignored. Reject them so the semantics are explicit (body steps run
      // unconditionally; the loop's exit `condition` is the only guard).
      if (body.when != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `step "${step.id}" is a loop body of "${owner}" and cannot have a \`when\` guard — ` +
            `loop body steps run unconditionally each iteration. Gate the loop via its ` +
            `\`condition\` (exit) instead.`,
          path: ['steps'],
        });
      }
      // A body step may declare `needs: [<loop step id>]` (the documented
      // convention) or depend on a sibling body step of the SAME loop (intra-
      // iteration ordering — the loop runs body steps in declared order).
      // Anything else is a cross-DAG edge that won't be honored, so reject it.
      for (const dep of body.needs) {
        if (dep === owner) continue;
        if (bodyOwner.get(dep) === owner) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `step "${step.id}" is a loop body of "${owner}" and may only \`needs\` its loop ` +
            `step ("${owner}") or a sibling body step of the same loop — "${dep}" is outside ` +
            `the loop and would never settle for it.`,
          path: ['steps'],
        });
      }
    }

    // FINDING 5: a NON-loop-body step that `needs` a loop-body step stalls the
    // executor — the body step is owned by its loop and excluded from the main
    // DAG, so its dependent never sees it settle. Depend on the loop step
    // itself instead. (The body step's own loop step is allowed to "need" it
    // implicitly via the loop, but no other step may.)
    for (const step of wf.steps) {
      if (bodyOwner.has(step.id)) continue; // body→body handled above
      if (step.loop != null) {
        // A loop step needing one of ITS OWN body ids is redundant but not a
        // stall (it owns them); needing ANOTHER loop's body is still a stall.
        const ownBody = new Set(step.loop.body);
        for (const dep of step.needs) {
          if (bodyOwner.has(dep) && !ownBody.has(dep)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                `step "${step.id}" needs "${dep}", which is a loop body of ` +
                `"${bodyOwner.get(dep)}" — depend on the loop step "${bodyOwner.get(dep)}" instead.`,
              path: ['steps'],
            });
          }
        }
        continue;
      }
      for (const dep of step.needs) {
        if (bodyOwner.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              `step "${step.id}" needs "${dep}", which is a loop body of ` +
              `"${bodyOwner.get(dep)}" — depend on the loop step "${bodyOwner.get(dep)}" instead ` +
              `(loop body steps are owned by their loop and never scheduled in the main DAG).`,
            path: ['steps'],
          });
        }
      }
    }
  });

/** DFS cycle detection over `needs` edges. Returns the cycle path or null. */
function findCycle(steps: ReadonlyArray<{ id: string; needs: ReadonlyArray<string> }>): string[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    const s = state.get(id);
    if (s === 'done') return null;
    if (s === 'visiting') {
      const from = stack.indexOf(id);
      return [...stack.slice(from), id];
    }
    const step = byId.get(id);
    if (!step) return null; // unknown dep already flagged elsewhere
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of step.needs) {
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const step of steps) {
    const found = visit(step.id);
    if (found) return found;
  }
  return null;
}

export interface WorkflowParseResult {
  readonly ok: boolean;
  readonly workflow?: Workflow;
  /** One readable line per issue, e.g. `step "a": prompt must not be empty`. */
  readonly errors: ReadonlyArray<string>;
}

/**
 * Render one zod issue as a human sentence instead of zod's library-speak
 * ("String must contain at least 1 character(s)"). These lines are read by
 * workflow authors in the builder banner/inspector and by agents fixing a
 * draft, so plain English wins over schema jargon.
 */
function humanizeIssue(iss: z.ZodIssue): string {
  switch (iss.code) {
    case 'too_small': {
      const min = Number(iss.minimum);
      if (iss.type === 'string') return min === 1 ? 'must not be empty' : `must be at least ${min} characters`;
      if (iss.type === 'array') return min === 1 ? 'needs at least one entry' : `needs at least ${min} entries`;
      return `must be at least ${min}`;
    }
    case 'too_big': {
      const max = Number(iss.maximum);
      if (iss.type === 'string') return `must be at most ${max} characters`;
      if (iss.type === 'array') return `can have at most ${max} entries`;
      return `must be at most ${max}`;
    }
    case 'invalid_type':
      return iss.received === 'undefined' ? 'is required' : `should be a ${iss.expected} (got ${iss.received})`;
    case 'invalid_enum_value':
      return `must be one of: ${iss.options.map((o) => `"${String(o)}"`).join(', ')}`;
    default:
      return iss.message;
  }
}

function formatIssues(error: z.ZodError, raw: unknown): string[] {
  const steps: unknown[] =
    raw !== null && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps)
      ? ((raw as { steps: unknown[] }).steps)
      : [];
  return error.issues.map((iss) => {
    // Refinement messages (superRefine/regex `message:`) already speak human
    // and name their step — pass them through untouched.
    if (iss.code === 'custom') return iss.message;
    const msg = humanizeIssue(iss);
    const [head, idx, ...rest] = iss.path;
    if (head === 'steps' && typeof idx === 'number') {
      // Anchor the line to the step's id (the `step "<id>"` shape is what the
      // builder uses to attach the error to the right node on the canvas).
      const step = steps[idx];
      const id =
        step !== null && typeof step === 'object' && typeof (step as { id?: unknown }).id === 'string'
          ? ((step as { id: string }).id)
          : '';
      const where = id ? `step "${id}"` : `step ${idx + 1}`;
      const field = rest.join('.');
      return field ? `${where}: ${field} ${msg}` : `${where} ${msg}`;
    }
    const path = iss.path.join('.');
    return path ? `${path} ${msg}` : `workflow ${msg}`;
  });
}

/** Validate an already-parsed object against the workflow schema. */
export function validateWorkflow(raw: unknown): WorkflowParseResult {
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error, raw) };
  return { ok: true, workflow: parsed.data as Workflow, errors: [] };
}

/** Parse + validate a YAML document into a Workflow. */
export function parseWorkflowYaml(text: string): WorkflowParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    return { ok: false, errors: [`yaml: ${err instanceof Error ? err.message : String(err)}`] };
  }
  return validateWorkflow(doc);
}

/** Serialize a Workflow back to canonical YAML (for `workflow_create` writes). */
export function serializeWorkflow(wf: Workflow): string {
  return stringifyYaml(wf, { lineWidth: 0 });
}
