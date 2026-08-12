import { defineTool } from '@moxxy/sdk';
import { z } from 'zod';

import { PLAN_COMPLETE_TOOL } from './constants.js';

const text = z.string().trim().min(1);

export const planStepSchema = z.object({
  id: z.string().trim().min(1).max(24).describe('Stable short id, for example P1.'),
  title: text.max(140).describe('Short action-oriented step title.'),
  outcome: text.max(600).describe('The observable result of completing this step.'),
  actions: z.array(text.max(500)).min(1).max(8).describe('Concrete work required for this step.'),
  files: z
    .array(text.max(300))
    .max(20)
    .optional()
    .describe('Likely files, packages, services, or surfaces involved.'),
  dependsOn: z
    .array(z.string().trim().min(1).max(24))
    .max(10)
    .optional()
    .describe('Ids of earlier steps that must complete first.'),
  verification: z
    .array(text.max(500))
    .max(8)
    .optional()
    .describe('Checks that prove this step is complete.'),
});

export const planDefinitionSchema = z
  .object({
    title: text.max(160),
    objective: text.max(800).describe('The intended end state, not a restatement of the prompt.'),
    approach: text.max(2_000).describe('A concise explanation of the proposed path and its rationale.'),
    assumptions: z.array(text.max(500)).max(10).optional(),
    questions: z
      .array(text.max(500))
      .max(10)
      .optional()
      .describe('Only unresolved decisions that could materially change implementation.'),
    steps: z.array(planStepSchema).min(1).max(24),
    risks: z
      .array(
        z.object({
          risk: text.max(500),
          mitigation: text.max(500),
        }),
      )
      .max(10)
      .optional(),
    recommendedMode: z
      .enum(['default', 'goal'])
      .describe('default for supervised/ambiguous work; goal only for safely autonomous execution.'),
    handoff: text
      .max(1_000)
      .describe('A compact instruction the execution mode can follow together with this plan.'),
  })
  .superRefine((plan, ctx) => {
    const known = new Set<string>();
    for (const [index, step] of plan.steps.entries()) {
      if (known.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'id'],
          message: `duplicate step id "${step.id}"`,
        });
      }
      for (const dependency of step.dependsOn ?? []) {
        if (!known.has(dependency)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', index, 'dependsOn'],
            message: `dependency "${dependency}" must reference an earlier step`,
          });
        }
      }
      known.add(step.id);
    }
    if ((plan.questions?.length ?? 0) > 0 && plan.recommendedMode === 'goal') {
      ctx.addIssue({
        code: 'custom',
        path: ['recommendedMode'],
        message: 'goal cannot be recommended while material decisions remain unresolved',
      });
    }
  });

export type PlanDefinition = z.infer<typeof planDefinitionSchema>;

export function acknowledgePlan(input: unknown): { acknowledged: true; title: string; steps: number } {
  const plan = planDefinitionSchema.parse(input);
  return { acknowledged: true, title: plan.title, steps: plan.steps.length };
}

export const planCompleteTool = defineTool({
  name: PLAN_COMPLETE_TOOL,
  description:
    'Submit the complete, implementation-ready plan and end this planning turn. ' +
    'This is a read-only control signal: it records the plan but performs none of its steps.',
  inputSchema: planDefinitionSchema,
  permission: { action: 'allow' },
  isolation: { capabilities: { net: { mode: 'none' }, timeMs: 10_000 } },
  handler: acknowledgePlan,
});
