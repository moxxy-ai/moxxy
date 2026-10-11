import { migrateModeName } from '@moxxy/sdk';

/**
 * What a vendor agent is asked to do for a Moxxy mode. Plan and goal use the
 * agent's own plan and goal; research, collaborative and the rest steer from
 * above the agent (they split or repeat turns), so each turn is ordinary work.
 */
export type AgentMode = 'default' | 'plan' | 'goal';

export function agentModeFor(mode: string): AgentMode {
  const current = migrateModeName(mode);
  return current === 'plan' || current === 'goal' ? current : 'default';
}
