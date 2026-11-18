import type OpenAI from 'openai';
import type { ReasoningEffort } from '@moxxy/sdk';

/** The OpenAI API's effort for a turn's: it has no ultra (Codex's max with subagents), so that is sent as max. */
export function openaiEffort(effort: ReasoningEffort | undefined): Exclude<OpenAI.ReasoningEffort, null> | undefined {
  return effort === 'ultra' ? 'max' : effort;
}
