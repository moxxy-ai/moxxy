import type { AgentBackgroundWork, MoxxyEvent, PluginEvent } from '@moxxy/sdk';
import {
  AGENT_BACKGROUND_WORK_ENDED_SUBTYPE,
  AGENT_BACKGROUND_WORK_SUBTYPE,
  SUBAGENT_MESSAGE_SUBTYPE,
  isAgentWorkEvent,
  isSubagentEvent,
} from '@moxxy/sdk/agent-work';

export { isAgentWorkEvent };

export type AgentWorkStatus = 'running' | 'completed' | 'failed' | 'stopped';

/** One thing a helper did, in order: a tool it called or something it said. */
export type AgentWorkStep =
  | { readonly kind: 'tool'; readonly name: string; readonly input: unknown }
  | { readonly kind: 'message'; readonly text: string };

/**
 * One work of the conversation's agent: a helper agent (its mini chat) or a
 * command it ran in the background (its output), as the Agents panel shows it.
 */
export interface AgentWorkItem {
  /** The agent's id for it: a helper's `childSessionId`, a command's work id. */
  readonly id: string;
  readonly kind: 'agent' | 'command';
  readonly label: string;
  /** The kind a helper was started as (`Explore`); null for a command. */
  readonly agentType: string | null;
  /** What the helper was asked to do, when the agent says. */
  readonly prompt: string | null;
  readonly status: AgentWorkStatus;
  /** Null when the work is only known from what runs now (its start is in an unloaded page). */
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
  readonly steps: ReadonlyArray<AgentWorkStep>;
  /** A helper's final answer. */
  readonly answer: string | null;
  readonly error: string | null;
  /** How the agent summed up a command's end. */
  readonly summary: string | null;
  /** What a command printed last. */
  readonly output: string | null;
  readonly tokensUsed: number | null;
  /** The `user_prompt` of the turn the agent opened when this work ended ("Agent continued"). */
  readonly continuedBy: string | null;
}

interface Draft {
  id: string;
  kind: 'agent' | 'command';
  label: string;
  agentType: string | null;
  prompt: string | null;
  status: AgentWorkStatus;
  startedAtMs: number | null;
  endedAtMs: number | null;
  steps: AgentWorkStep[];
  answer: string | null;
  error: string | null;
  summary: string | null;
  output: string | null;
  tokensUsed: number | null;
  continuedBy: string | null;
  /** Named in a background-work list: only such work ends by dropping off it. */
  listed: boolean;
}

/**
 * Every helper and background command of the conversation, newest first,
 * folded from its log. `runningNow` (`SessionInfo.backgroundWork`) is what
 * the agent runs at this moment: it wins over the log, so a runner that
 * restarted shows nothing running that no longer runs, and work whose start
 * lies outside the loaded events still shows.
 */
export function agentWorkFromEvents(
  events: ReadonlyArray<MoxxyEvent>,
  runningNow?: ReadonlyArray<AgentBackgroundWork>,
): AgentWorkItem[] {
  const items = new Map<string, Draft>();
  for (const event of events) {
    if (event.type === 'user_prompt') {
      const workId = event.origin?.kind === 'agent' ? event.origin.workId : undefined;
      const item = workId === undefined ? undefined : items.get(workId);
      if (item) item.continuedBy = String(event.id);
      continue;
    }
    if (event.type !== 'plugin_event') continue;
    if (isSubagentEvent(event)) foldHelper(items, event);
    else if (isAgentWorkEvent(event)) foldWork(items, event);
  }
  if (runningNow) believeRunning(items, runningNow);
  return [...items.values()].reverse().map(({ listed: _listed, ...item }) => item);
}

function foldHelper(items: Map<string, Draft>, e: PluginEvent): void {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const id = typeof payload.childSessionId === 'string' ? payload.childSessionId : '';
  if (!id) return;
  if (e.subtype === 'subagent_started') {
    // The background list may name a helper before its start is recorded.
    const item = items.get(id) ?? draft(items, id, 'agent', text(payload.label) ?? 'Helper', e.ts);
    item.label = text(payload.label) ?? item.label;
    item.startedAtMs = e.ts;
    item.agentType = text(payload.agentType) ?? 'default';
    item.prompt = text(payload.prompt);
    item.status = 'running';
    return;
  }
  const item = items.get(id);
  if (!item) return;
  if (e.subtype === 'subagent_tool_call') {
    item.steps.push({ kind: 'tool', name: text(payload.name) ?? 'tool', input: payload.input });
  } else if (e.subtype === SUBAGENT_MESSAGE_SUBTYPE) {
    const said = text(payload.text);
    if (said) item.steps.push({ kind: 'message', text: said });
  } else if (e.subtype === 'subagent_completed') {
    const answer = text(payload.text);
    // The helper's last words are often its answer: show them once, as the answer.
    const last = item.steps.at(-1);
    if (answer && last?.kind === 'message' && last.text.trim() === answer.trim()) item.steps.pop();
    item.answer = answer;
    item.error = text(payload.error);
    item.tokensUsed = typeof payload.tokensUsed === 'number' ? payload.tokensUsed : null;
    item.status = payload.stopReason === 'stopped' ? 'stopped' : item.error ? 'failed' : 'completed';
    item.endedAtMs = e.ts;
  } else if (e.subtype === 'subagent_error' || e.subtype === 'subagent_abort') {
    item.error = text(payload.message) ?? text(payload.reason) ?? 'aborted';
    item.status = e.subtype === 'subagent_abort' ? 'stopped' : 'failed';
    item.endedAtMs = e.ts;
  }
}

function foldWork(items: Map<string, Draft>, e: PluginEvent): void {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  if (e.subtype === AGENT_BACKGROUND_WORK_SUBTYPE) {
    const work = Array.isArray(payload.work) ? (payload.work as ReadonlyArray<AgentBackgroundWork>) : [];
    const now = new Set(work.map((entry) => entry.id));
    for (const item of items.values()) if (item.listed && !now.has(item.id)) settle(item, e.ts);
    for (const entry of work) {
      const item = items.get(entry.id) ?? draft(items, entry.id, entry.kind, entry.label, e.ts);
      item.listed = true;
    }
    return;
  }
  if (e.subtype !== AGENT_BACKGROUND_WORK_ENDED_SUBTYPE || typeof payload.id !== 'string') return;
  const kind = payload.kind === 'agent' ? 'agent' : 'command';
  const item = items.get(payload.id) ?? draft(items, payload.id, kind, text(payload.label) ?? 'Background command', null);
  item.status = payload.status === 'completed' || payload.status === 'failed' ? payload.status : 'stopped';
  item.summary = text(payload.summary);
  item.output = text(payload.output);
  item.endedAtMs = e.ts;
}

function believeRunning(items: Map<string, Draft>, runningNow: ReadonlyArray<AgentBackgroundWork>): void {
  const now = new Set(runningNow.map((entry) => entry.id));
  for (const item of items.values()) if (item.listed && !now.has(item.id)) settle(item, null);
  for (const entry of runningNow) if (!items.has(entry.id)) draft(items, entry.id, entry.kind, entry.label, null).listed = true;
}

/** Work that stopped running with no end of its own: the agent, or the process running it, is gone. */
function settle(item: Draft, atMs: number | null): void {
  if (item.status !== 'running') return;
  item.status = 'stopped';
  item.endedAtMs = atMs;
}

function draft(items: Map<string, Draft>, id: string, kind: Draft['kind'], label: string, startedAtMs: number | null): Draft {
  const item: Draft = {
    id,
    kind,
    label,
    agentType: null,
    prompt: null,
    status: 'running',
    startedAtMs,
    endedAtMs: null,
    steps: [],
    answer: null,
    error: null,
    summary: null,
    output: null,
    tokensUsed: null,
    continuedBy: null,
    listed: false,
  };
  items.set(id, item);
  return item;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
