import { AGENT_CONNECTION_PLUGIN_ID } from './agent-step.js';
import type { MoxxyEvent } from './events.js';

/**
 * Recorded under `AGENT_CONNECTION_PLUGIN_ID` at the end of a turn the agent took up by
 * itself ("Agent continued") in which it said nothing and ran nothing, so every surface
 * says so instead of leaving the turn's marker alone in the chat.
 */
export const AGENT_NO_REPLY_SUBTYPE = 'no_reply';

/** How every surface words the note. */
export const AGENT_NO_REPLY_TEXT = 'The agent finished without replying.';

export function isAgentNoReplyEvent(event: MoxxyEvent): boolean {
  return event.type === 'plugin_event' && event.pluginId === AGENT_CONNECTION_PLUGIN_ID && event.subtype === AGENT_NO_REPLY_SUBTYPE;
}
