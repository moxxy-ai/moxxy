import { EventEmitter } from 'node:events';
import { waitFor, type AgentBackgroundWork, type AgentStepEvent } from '@moxxy/sdk';
import { toolCallOf } from './translate.js';
import type { CodexItem } from './protocol.js';

interface Running {
  readonly label: string;
  text: string;
  tokens: number | undefined;
  done: boolean;
  /** The turn running in its thread now, which Stop interrupts. */
  turn?: string;
  readonly commands: Map<string, { turn: string; finished: boolean }>;
  stop?: SubagentStop;
}

export class SubagentStop {
  readonly changes = new EventEmitter();
  /** Codex’s final event: true for an interruption, false for natural completion. */
  stopped?: boolean;
  attempt?: Promise<boolean>;

  constructor(readonly turn: string, readonly commands: Running['commands']) {}

  async until(check: () => boolean, signal: AbortSignal): Promise<void> {
    const outcome = await waitFor(() => check() || undefined, {
      signal,
      wakeOn: [(wake) => {
        this.changes.on('change', wake);
        return () => { this.changes.off('change', wake); };
      }],
    });
    if (outcome.status !== 'ready') throw new Error('Codex did not confirm that this helper stopped.');
  }
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
      const label = labelOf(a.agentPath);
      this.agents.set(id, { label, text: '', tokens: undefined, done: false, commands: new Map() });
      return [{ type: 'subagent_started', id, label, agentType: 'default' }];
    }
    if ((a.kind !== 'completed' && a.kind !== 'interrupted') || !known || known.done) return [];
    return this.ended(id, known, a.kind === 'interrupted');
  }

  /** A notification from a thread other than the conversation's: a subagent's work, if it is one. */
  fromThread(method: string, params: Record<string, unknown>): AgentStepEvent[] {
    const id = typeof params.threadId === 'string' ? params.threadId : '';
    const agent = this.agents.get(id);
    if (!agent || agent.done) return [];
    if (method === 'turn/started' || method === 'turn/completed') {
      const turn = params.turn as { id?: unknown; status?: unknown } | undefined;
      if (method === 'turn/started') {
        if (typeof turn?.id === 'string') agent.turn = turn.id;
        return [];
      }
      if (typeof turn?.id === 'string' && agent.turn && agent.turn !== turn.id) {
        if (agent.stop?.turn === turn.id) this.ended(id, agent, turn.status === 'interrupted');
        return [];
      }
      delete agent.turn;
      // Between the conversation's turns Codex reports a stopped subagent only here.
      return turn?.status === 'interrupted' ? this.ended(id, agent, true) : [];
    }
    if (method === 'thread/tokenUsage/updated') {
      const total = (params.tokenUsage as { total?: { totalTokens?: unknown } } | undefined)?.total;
      if (total && typeof total.totalTokens === 'number') agent.tokens = total.totalTokens;
      return [];
    }
    if (method !== 'item/started' && method !== 'item/completed') return [];
    const item = params.item as CodexItem | undefined;
    if (item?.type === 'commandExecution' && typeof params.turnId === 'string') {
      agent.commands.set(item.id, { turn: params.turnId, finished: method === 'item/completed' });
      agent.stop?.changes.emit('change');
    }
    if (method === 'item/started') return [];
    if (!item) return [];
    if (item.type === 'agentMessage') {
      if (!item.text) return [];
      agent.text = item.text;
      // The final answer shows as the subagent's answer when it ends.
      return (item as { phase?: unknown }).phase === 'final_answer' ? [] : [{ type: 'subagent_message', id, text: item.text }];
    }
    const call = toolCallOf(item);
    return call ? [{ type: 'subagent_tool_call', id, name: call.name, input: call.input }] : [];
  }

  /** The subagents still working, as background work. */
  running(): AgentBackgroundWork[] {
    return [...this.agents].flatMap(([id, agent]) => (agent.done ? [] : [{ id, kind: 'agent' as const, label: agent.label }]));
  }

  beginStop(id: string): SubagentStop | undefined {
    const agent = this.agents.get(id);
    if (!agent || agent.done) return undefined;
    if (agent.stop) return agent.stop;
    if (!agent.turn) return undefined;
    agent.stop = new SubagentStop(agent.turn, agent.commands);
    return agent.stop;
  }

  cancelUnacceptedStop(id: string): void {
    const agent = this.agents.get(id);
    if (agent && agent.stop?.stopped === undefined) delete agent.stop;
  }

  /** Hold Codex's end notification until its surviving commands have been checked. */
  private ended(id: string, agent: Running, stopped: boolean): AgentStepEvent[] {
    if (!agent.stop) return [end(id, agent, stopped)];
    if (agent.stop.stopped === undefined) {
      agent.stop.stopped = stopped;
      agent.stop.changes.emit('change');
    }
    return [];
  }

  confirmStop(id: string): AgentStepEvent[] {
    const agent = this.agents.get(id);
    if (!agent || !agent.stop || agent.stop.stopped === undefined) return [];
    const { turn, stopped } = agent.stop;
    delete agent.stop;
    if (agent.turn && agent.turn !== turn) return [];
    return [end(id, agent, stopped)];
  }
}

function end(id: string, agent: Running, stopped: boolean): AgentStepEvent {
  agent.done = true;
  agent.commands.clear();
  return {
    type: 'subagent_completed',
    id,
    text: agent.text,
    ...(agent.tokens !== undefined ? { tokensUsed: agent.tokens } : {}),
    ...(stopped ? { error: 'The subagent was stopped.', stopped: true as const } : {}),
  };
}

/** "/root/inspect_folder" → "inspect folder". */
export function labelOf(path: unknown): string {
  const last = typeof path === 'string' ? path.split('/').filter(Boolean).pop() : undefined;
  return last ? last.replace(/[_-]+/g, ' ') : 'subagent';
}
