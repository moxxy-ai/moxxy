import type { MoxxyEvent } from '@moxxy/sdk';
import { agentComputerUseOf, type AgentComputerUse } from '@moxxy/sdk/agent-computer-use';

/**
 * Whether the agent of an agent connection has used the person's computer in the running
 * turn, and the last app it named; `null` when it has not. Read from the turn's own events,
 * so every surface that has the log says the same. Moxxy's own computer tools are not counted:
 * they have their own controls.
 */
export function turnComputerUse(events: ReadonlyArray<MoxxyEvent>): AgentComputerUse | null {
  let used = false;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'user_prompt' && e.origin?.kind !== 'checkpoint') break;
    if (e.type !== 'tool_call_requested' || e.executedBy !== 'provider') continue;
    const use = agentComputerUseOf(e.name, e.input);
    if (!use) continue;
    if (use.app) return use;
    used = true;
  }
  return used ? { app: null } : null;
}
