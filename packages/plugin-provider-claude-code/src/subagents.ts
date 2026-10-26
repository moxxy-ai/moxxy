import type { AgentStepEvent } from '@moxxy/sdk';

/** Claude's tool that starts a subagent: `Agent` in Claude Code 2.1, `Task` before. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);

interface Running {
  text: string;
  tokens: number | undefined;
  /** Claude went on without waiting for it; only its task note ends it. */
  background: boolean;
  done: boolean;
  /** What it said, each shown once: a message read between turns comes again in the next turn. */
  readonly said: Set<string>;
}

/**
 * Claude's subagents. The call that starts one is shown as the subagent; its own calls carry
 * the starting call's id (`parent_tool_use_id`) and show under it. One running in the background
 * ends later, when Claude reports its task finished, so the session keeps them across turns.
 */
export class ClaudeSubagents {
  private readonly agents = new Map<string, Running>();
  /** A subagent's call → the subagent it belongs to. */
  private readonly calls = new Map<string, string>();

  isSubagentTool(name: string): boolean {
    return SUBAGENT_TOOLS.has(name);
  }

  /** Whether a call started a subagent. */
  isSubagent(callId: string): boolean {
    return this.agents.has(callId);
  }

  /** The subagent a call belongs to, if it is a subagent's call. */
  ownerOf(callId: string): string | undefined {
    return this.calls.get(callId);
  }

  started(callId: string, input: unknown): AgentStepEvent[] {
    if (this.agents.has(callId)) return [];
    this.agents.set(callId, { text: '', tokens: undefined, background: false, done: false, said: new Set() });
    const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const label = typeof fields.description === 'string' && fields.description ? fields.description : 'subagent';
    const agentType = typeof fields.subagent_type === 'string' && fields.subagent_type ? fields.subagent_type : 'general-purpose';
    const prompt = typeof fields.prompt === 'string' && fields.prompt ? fields.prompt : undefined;
    return [{ type: 'subagent_started', id: callId, label, agentType, ...(prompt ? { prompt } : {}) }];
  }

  /** What a subagent said and called, from one of its messages; each once, however often the message is read. */
  fromMessage(parent: string, text: string, calls: ReadonlyArray<{ readonly id: string; readonly name: string; readonly input: unknown }>): AgentStepEvent[] {
    const agent = this.agents.get(parent);
    if (!agent || agent.done) return [];
    const events: AgentStepEvent[] = [];
    if (text) {
      agent.text = text;
      if (!agent.said.has(text)) events.push({ type: 'subagent_message', id: parent, text });
      agent.said.add(text);
    }
    for (const call of calls) {
      if (this.calls.has(call.id)) continue;
      this.calls.set(call.id, parent);
      events.push({ type: 'subagent_tool_call', id: parent, name: call.name, input: call.input });
    }
    return events;
  }

  /**
   * The result of the call that started a subagent: its answer, unless it went on in the background.
   * The result Claude's model reads wraps the answer in a hand-back note, so the report's own text is preferred.
   */
  fromResult(callId: string, text: string, isError: boolean, report: unknown): AgentStepEvent[] {
    const r = typeof report === 'object' && report !== null ? (report as { isAsync?: unknown; totalTokens?: unknown; content?: unknown }) : {};
    if (r.isAsync === true && !isError) {
      const agent = this.agents.get(callId);
      if (agent) agent.background = true;
      return [];
    }
    if (isError) return this.end(callId, { text: '', error: text });
    const answer = reportText(r.content) || text || this.textOf(callId);
    return this.end(callId, { text: answer, ...(typeof r.totalTokens === 'number' ? { tokens: r.totalTokens } : {}) });
  }

  /** Claude's task reports: progress (tokens so far) and the end of a subagent in the background. */
  fromTaskNote(note: { readonly subtype: string; readonly tool_use_id?: unknown; readonly status?: unknown; readonly summary?: unknown; readonly usage?: unknown }): AgentStepEvent[] {
    if (typeof note.tool_use_id !== 'string') return [];
    const agent = this.agents.get(note.tool_use_id);
    if (!agent) return [];
    if (note.subtype === 'task_progress') {
      const usage = note.usage as { total_tokens?: unknown } | undefined;
      if (usage && typeof usage.total_tokens === 'number') agent.tokens = usage.total_tokens;
      return [];
    }
    // A subagent Claude waited for ends with the call's result, which carries its answer.
    if (note.subtype !== 'task_notification' || !agent.background) return [];
    if (note.status === 'completed') return this.end(note.tool_use_id, { text: agent.text || (typeof note.summary === 'string' ? note.summary : '') });
    const reason = typeof note.summary === 'string' && note.summary ? note.summary : `The subagent ${typeof note.status === 'string' ? note.status : 'stopped'}.`;
    return this.end(note.tool_use_id, { text: '', error: reason, stopped: note.status === 'stopped' });
  }

  private textOf(callId: string): string {
    const agent = this.agents.get(callId);
    return agent ? agent.text : '';
  }

  private end(callId: string, outcome: { readonly text: string; readonly tokens?: number; readonly error?: string; readonly stopped?: boolean }): AgentStepEvent[] {
    const agent = this.agents.get(callId);
    if (!agent || agent.done) return [];
    agent.done = true;
    const tokens = outcome.tokens ?? agent.tokens;
    return [{ type: 'subagent_completed', id: callId, text: outcome.text, ...(tokens !== undefined ? { tokensUsed: tokens } : {}), ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.stopped ? { stopped: true as const } : {}) }];
  }
}

function reportText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part: unknown) => {
      const p = typeof part === 'object' && part !== null ? (part as { type?: unknown; text?: unknown }) : {};
      return p.type === 'text' && typeof p.text === 'string' && p.text ? [p.text] : [];
    })
    .join('\n');
}
