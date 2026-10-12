import type { MoxxyEvent } from './events.js';
import { asPluginId } from './ids.js';

/**
 * Where an agent connection keeps the vendor agent's session in the log. The
 * `agentStep` contract itself is part of the provider types (`provider.ts`).
 */

export const AGENT_CONNECTION_PLUGIN_ID = asPluginId('@moxxy/agent-connection');
export const AGENT_SESSION_SUBTYPE = 'agent_session';
/** The state of the agent's own goal (Claude `/goal`, Codex `thread/goal`), recorded after its turn. */
export const AGENT_GOAL_SUBTYPE = 'goal_status';
/** Where subagents are recorded, the agent's own as well as Moxxy's (`@moxxy/core` writes the same envelope). */
export const SUBAGENTS_PLUGIN_ID = asPluginId('@moxxy/subagents');

/** The agent session to resume for this provider: the last one recorded, if any. */
export function agentSessionFromEvents(events: ReadonlyArray<MoxxyEvent>, provider: string): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'plugin_event') continue;
    if (event.pluginId !== AGENT_CONNECTION_PLUGIN_ID || event.subtype !== AGENT_SESSION_SUBTYPE) continue;
    const payload = event.payload as { provider?: unknown; sessionId?: unknown } | null;
    if (payload && payload.provider === provider && typeof payload.sessionId === 'string') return payload.sessionId;
  }
  return undefined;
}
