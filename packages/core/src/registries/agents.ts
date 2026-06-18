import type { AgentDef } from '@moxxy/sdk';
import { DefMapRegistry } from './def-map-registry.js';

/**
 * Registry of named subagent kinds contributed by plugins. The
 * `dispatch_agent` tool looks definitions up here by `agentType` and
 * uses them as templates (systemPrompt, allowedTools, mode, …)
 * for the spawned child.
 *
 * A flat name→def map ({@link DefMapRegistry}): register throws on
 * duplicate so two plugins can't silently shadow each other — use
 * `replace()` when you really want to override (e.g. user-config overrides).
 */
export class AgentRegistry extends DefMapRegistry<AgentDef> {
  constructor() {
    super({ noun: 'Agent', keyOf: (def) => def.name });
  }
}
