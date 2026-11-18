import type { ReasoningEffort } from '@moxxy/sdk';

/**
 * The Messages API has `xhigh` and `max` on some models only, so every level
 * above `high` is sent as `high`. A turn asks for `max` or `ultra` here only
 * when a model names them, which no Messages API model does.
 */
export function anthropicEffort(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  return effort === 'low' || effort === 'medium' ? effort : 'high';
}
