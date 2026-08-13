import type { CollectedToolUse, MoxxyEvent } from '@moxxy/sdk';

import { PLAN_COMPLETE_TOOL } from './constants.js';
import { planDefinitionSchema, type PlanDefinition } from './plan-tool.js';

export function detectCompletedPlan(
  log: ReadonlyArray<MoxxyEvent>,
  batch: ReadonlyArray<CollectedToolUse>,
): PlanDefinition | null {
  const calls = new Map(
    batch.filter((call) => call.name === PLAN_COMPLETE_TOOL).map((call) => [call.id, call]),
  );
  if (calls.size === 0) return null;

  for (let i = log.length - 1; i >= 0; i--) {
    const event = log[i];
    if (!event || event.type !== 'tool_result' || !event.ok) continue;
    const call = calls.get(String(event.callId));
    if (!call) continue;
    const parsed = planDefinitionSchema.safeParse(call.input);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export function formatPlan(plan: PlanDefinition): string {
  const sections = [`# ${plan.title}`, plan.objective, `## Approach\n\n${plan.approach}`];

  if (plan.assumptions && plan.assumptions.length > 0) {
    sections.push(`## Assumptions\n\n${bullets(plan.assumptions)}`);
  }
  if (plan.questions && plan.questions.length > 0) {
    sections.push(`## Decisions still needed\n\n${bullets(plan.questions)}`);
  }

  const steps = plan.steps
    .map((step, index) => {
      const details = [step.outcome, ...step.actions.map((action) => `- ${action}`)];
      if (step.files && step.files.length > 0) details.push(`- **Touches:** ${step.files.join(', ')}`);
      if (step.dependsOn && step.dependsOn.length > 0) {
        details.push(`- **Depends on:** ${step.dependsOn.join(', ')}`);
      }
      if (step.verification && step.verification.length > 0) {
        details.push(`- **Verify:** ${step.verification.join('; ')}`);
      }
      return `${index + 1}. **${step.id} — ${step.title}**\n\n   ${details.join('\n   ')}`;
    })
    .join('\n\n');
  sections.push(`## Plan\n\n${steps}`);

  if (plan.risks && plan.risks.length > 0) {
    const risks = plan.risks.map(({ risk, mitigation }) => `- **${risk}** — ${mitigation}`).join('\n');
    sections.push(`## Risks\n\n${risks}`);
  }

  const execution =
    plan.recommendedMode === 'goal'
      ? 'The plan is bounded and verifiable enough for autonomous execution.'
      : 'Keep execution supervised so decisions and risky changes remain reviewable.';
  sections.push(
    `## Next\n\nRecommended mode: **${plan.recommendedMode}** — ${execution}\n\n` +
      `**Execution brief:** ${plan.handoff}\n\n` +
      `- Reply with changes to keep refining this plan.\n` +
      `- Use \`/mode default\`, then ask to implement the approved plan for supervised work.\n` +
      `- Use \`/goal Execute the approved plan above.\` to execute it autonomously.`,
  );

  return sections.join('\n\n');
}

function bullets(items: ReadonlyArray<string>): string {
  return items.map((item) => `- ${item}`).join('\n');
}
