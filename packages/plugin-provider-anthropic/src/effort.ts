import type { ReasoningEffort } from '@moxxy/sdk';

/** The Messages API has no `xhigh` on every model that thinks, so it is sent as `high`. */
export function anthropicEffort(effort: ReasoningEffort): 'low' | 'medium' | 'high' {
  return effort === 'xhigh' ? 'high' : effort;
}
