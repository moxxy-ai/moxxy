import { AGENT_CONNECTION_PLUGIN_ID, SUBAGENTS_PLUGIN_ID } from './agent-step.js';
import type { PluginId } from './ids.js';
import type { MoxxyEvent } from './events.js';
import type { AgentStepEvent } from './provider.js';

/** Everything the agent runs in the background now (`AGENT_CONNECTION_PLUGIN_ID`); each record replaces the one before. */
export const AGENT_BACKGROUND_WORK_SUBTYPE = 'background_work';
/** One background work ended (`AGENT_CONNECTION_PLUGIN_ID`), with what it printed last. */
export const AGENT_BACKGROUND_WORK_ENDED_SUBTYPE = 'background_work_ended';
/** What a subagent said as it worked (`SUBAGENTS_PLUGIN_ID`). */
export const SUBAGENT_MESSAGE_SUBTYPE = 'subagent_message';
/** How much of a command's output a `background_work_ended` keeps: its end, which says how it went. */
export const AGENT_WORK_OUTPUT_LIMIT = 4096;

/** A record of the agent's background work (its list, an end): read by the Agents pane, never drawn in the chat. */
export function isAgentWorkEvent(event: MoxxyEvent): boolean {
  return (
    event.type === 'plugin_event' &&
    event.pluginId === AGENT_CONNECTION_PLUGIN_ID &&
    (event.subtype === AGENT_BACKGROUND_WORK_SUBTYPE || event.subtype === AGENT_BACKGROUND_WORK_ENDED_SUBTYPE)
  );
}

/** A record of a helper agent (its start, steps, words, end), from Moxxy's own subagents or an agent connection's. */
export function isSubagentEvent(event: MoxxyEvent): boolean {
  return event.type === 'plugin_event' && event.pluginId === SUBAGENTS_PLUGIN_ID;
}

/** A `plugin_event` without its envelope (session, turn, id, time). */
export interface AgentActivityRecord {
  readonly source: 'plugin' | 'system';
  readonly pluginId: PluginId;
  readonly subtype: string;
  readonly payload: Record<string, unknown>;
}

/** The helpers of a conversation by id, kept to name them in the records of their later events. */
export type SubagentNames = Map<string, { readonly label: string; readonly agentType: string }>;

/**
 * How an agent's helpers and background work are recorded in the log, the
 * same whether they come in a turn or between turns; `undefined` for any
 * other event.
 */
export function agentActivityRecord(event: AgentStepEvent, provider: string, names: SubagentNames): AgentActivityRecord | undefined {
  switch (event.type) {
    case 'subagent_started':
      names.set(event.id, { label: event.label, agentType: event.agentType });
      return subagentRecord('subagent_started', {
        childSessionId: event.id,
        label: event.label,
        agentType: event.agentType,
        ...(event.prompt ? { prompt: event.prompt } : {}),
        ...(event.toolsUnseen ? { toolsUnseen: true } : {}),
      });
    case 'subagent_tool_call': {
      const named = names.get(event.id);
      return subagentRecord('subagent_tool_call', { childSessionId: event.id, ...(named ? { label: named.label } : {}), name: event.name, input: event.input });
    }
    case 'subagent_message': {
      const named = names.get(event.id);
      return subagentRecord(SUBAGENT_MESSAGE_SUBTYPE, { childSessionId: event.id, ...(named ? { label: named.label } : {}), text: event.text });
    }
    case 'subagent_completed': {
      const named = names.get(event.id);
      return subagentRecord('subagent_completed', {
        childSessionId: event.id,
        ...(named ? { label: named.label, agentType: named.agentType } : {}),
        text: event.text,
        stopReason: event.stopped ? 'stopped' : event.error ? 'error' : 'end_turn',
        ...(event.tokensUsed !== undefined ? { tokensUsed: event.tokensUsed } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
    }
    case 'background_work':
      return workRecord(AGENT_BACKGROUND_WORK_SUBTYPE, { provider, work: event.work.map(({ id, kind, label }) => ({ id, kind, label })) });
    case 'background_work_ended':
      return workRecord(AGENT_BACKGROUND_WORK_ENDED_SUBTYPE, {
        provider,
        id: event.id,
        kind: event.kind,
        label: event.label,
        status: event.status,
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.output ? { output: outputEnd(event.output) } : {}),
      });
    default:
      return undefined;
  }
}

function subagentRecord(subtype: string, payload: Record<string, unknown>): AgentActivityRecord {
  return { source: 'plugin', pluginId: SUBAGENTS_PLUGIN_ID, subtype, payload };
}

function workRecord(subtype: string, payload: Record<string, unknown>): AgentActivityRecord {
  return { source: 'system', pluginId: AGENT_CONNECTION_PLUGIN_ID, subtype, payload };
}

function outputEnd(output: string): string {
  return output.length <= AGENT_WORK_OUTPUT_LIMIT ? output : output.slice(-AGENT_WORK_OUTPUT_LIMIT);
}
