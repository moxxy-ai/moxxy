import type { AgentStepEvent } from '@moxxy/sdk';
import { toolCallOf } from './translate.js';
import type { CodexItem } from './protocol.js';

interface Running {
  text: string;
  tokens: number | undefined;
  done: boolean;
}

/**
 * Codex's subagents. Codex announces one with a `subAgentActivity` item on the conversation's
 * thread and runs it in a thread of its own; its tool calls and answer come from that thread.
 * They outlive a Moxxy turn, so the session keeps them.
 */
export class CodexSubagents {
  private readonly agents = new Map<string, Running>();

  /** A `subAgentActivity` item on the conversation's thread. */
  activity(item: unknown): AgentStepEvent[] {
    const a = (item ?? {}) as { kind?: unknown; agentThreadId?: unknown; agentPath?: unknown };
    if (typeof a.agentThreadId !== 'string') return [];
    const id = a.agentThreadId;
    const known = this.agents.get(id);
    if (a.kind === 'started') {
      if (known) return [];
      this.agents.set(id, { text: '', tokens: undefined, done: false });
      return [{ type: 'subagent_started', id, label: labelOf(a.agentPath), agentType: 'default' }];
    }
    if (a.kind !== 'completed' || !known || known.done) return [];
    known.done = true;
    return [{ type: 'subagent_completed', id, text: known.text, ...(known.tokens !== undefined ? { tokensUsed: known.tokens } : {}) }];
  }

  /** A notification from a thread other than the conversation's: a subagent's work, if it is one. */
  fromThread(method: string, params: Record<string, unknown>): AgentStepEvent[] {
    const id = typeof params.threadId === 'string' ? params.threadId : '';
    const agent = this.agents.get(id);
    if (!agent || agent.done) return [];
    if (method === 'thread/tokenUsage/updated') {
      const total = (params.tokenUsage as { total?: { totalTokens?: unknown } } | undefined)?.total;
      if (total && typeof total.totalTokens === 'number') agent.tokens = total.totalTokens;
      return [];
    }
    if (method !== 'item/completed') return [];
    const item = params.item as CodexItem | undefined;
    if (!item) return [];
    if (item.type === 'agentMessage') {
      if (item.text) agent.text = item.text;
      return [];
    }
    const call = toolCallOf(item);
    return call ? [{ type: 'subagent_tool_call', id, name: call.name, input: call.input }] : [];
  }
}

/** "/root/inspect_folder" → "inspect folder". */
export function labelOf(path: unknown): string {
  const last = typeof path === 'string' ? path.split('/').filter(Boolean).pop() : undefined;
  return last ? last.replace(/[_-]+/g, ' ') : 'subagent';
}
