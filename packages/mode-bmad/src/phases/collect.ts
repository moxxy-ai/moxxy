import {
  buildSystemPromptWithSkills,
  collectProviderStream,
  projectMessages,
  runCompactionIfNeeded,
  usageEventFields,
  type ModeContext,
  type ProviderMessage,
} from '@moxxy/sdk';

import type { Artifacts, PhaseId, PhaseSpec } from '../constants.js';

/**
 * Stream one phase's artifact from the provider, emitting the provider
 * request/response bookends and assistant chunks. Returns the collected
 * text, or `null` when the provider errored (already emitted).
 */
export async function collectPhase(
  ctx: ModeContext,
  phase: PhaseSpec,
  artifactsSoFar: Artifacts,
  redraftFeedback: string | null,
): Promise<string | null> {
  await runCompactionIfNeeded(ctx);
  const messages = buildPhaseMessages(ctx, phase, artifactsSoFar, redraftFeedback);

  await ctx.emit({
    type: 'provider_request',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
  });

  const { text, usage, error } = await collectProviderStream(ctx, messages, {
    includeTools: false,
    maxTokens: phase.maxTokens,
  });
  if (error) {
    await ctx.emit({
      type: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      kind: error.retryable ? 'retryable' : 'fatal',
      message: error.message,
    });
    return null;
  }

  await ctx.emit({
    type: 'provider_response',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    provider: ctx.provider.name,
    model: ctx.model,
    ...usageEventFields(usage),
  });

  return text;
}

function buildPhaseMessages(
  ctx: ModeContext,
  phase: PhaseSpec,
  artifactsSoFar: Artifacts,
  redraftFeedback: string | null,
): ProviderMessage[] {
  const systemWithSkills = buildSystemPromptWithSkills(ctx.systemPrompt, ctx.skills.list()) ?? '';
  const systemPrompt = phase.system + (systemWithSkills ? `\n\n${systemWithSkills}` : '');
  const messages = buildBaseMessages(ctx, systemPrompt);

  // Inject upstream artifacts (analysis + planning when in solutioning,
  // etc.) as a system-of-record block. We use a synthetic user turn
  // rather than a second system message because providers handle
  // multi-system inputs inconsistently.
  const upstream = upstreamContext(phase.id, artifactsSoFar);
  if (upstream) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: upstream }],
    });
  }

  if (redraftFeedback) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `The previous ${phase.id} draft needs to be redone. Feedback from the user: ${redraftFeedback}\n\n` +
            `Produce a new ${phase.title} output addressing this feedback.`,
        },
      ],
    });
  }

  return messages;
}

function upstreamContext(phaseId: PhaseId, artifacts: Artifacts): string | null {
  const parts: string[] = [];
  if (phaseId === 'planning' || phaseId === 'solutioning') {
    if (artifacts.analysis) parts.push(`## Analyst brief\n${artifacts.analysis}`);
  }
  if (phaseId === 'solutioning') {
    if (artifacts.planning) parts.push(`## Story list\n${artifacts.planning}`);
  }
  return parts.length === 0 ? null : parts.join('\n\n');
}

/** Project the live log (with the phase system prompt) as the bottom layer;
 *  upstream artifacts and redraft feedback get layered on top. Goes through
 *  the shared `projectMessages` so artifact phases inherit compaction /
 *  turn-boundary elision / orphan-tool_use synthesis like every other mode
 *  (the previous hand-rolled `user_prompt`-only scan bypassed all three). */
function buildBaseMessages(ctx: ModeContext, systemPrompt: string): ProviderMessage[] {
  return projectMessages(ctx, { systemPrompt }).messages;
}
