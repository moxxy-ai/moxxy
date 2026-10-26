import type { AgentBackgroundWork, AgentStepEvent } from '@moxxy/sdk';
import type { OpenCodeEvent } from './opencode-api.js';
import { shownCall } from './translate.js';

/** What one OpenCode event meant for the conversation. */
export interface HelperNews {
  /** What subagents did: their tools, what they said, how they ended. */
  readonly steps: AgentStepEvent[];
  /** The background work list changed. */
  readonly workChanged: boolean;
  /** OpenCode prompted the conversation's session itself with a background subagent's result: it starts a turn of its own. */
  readonly finished?: { readonly workId: string; readonly label: string; readonly failed: boolean };
  /** The conversation's session started or stopped working. */
  readonly status?: 'busy' | 'idle';
  /** OpenCode waits for the person's account limit (its free tier, its Go plan) to reset before it tries again. */
  readonly limitReached?: true;
}

interface Helper {
  /** The `task` call that started it: the id of its `subagent_*` events and of its background work. */
  readonly callId: string;
  readonly label: string;
  readonly background: boolean;
  /** Its last finished text, its answer once it ends. */
  said: string;
  error: string | undefined;
  stopping: boolean;
  done: boolean;
  /** Its tool parts already shown. */
  readonly shownTools: Set<string>;
  readonly shownTexts: Set<string>;
}

/** Events of a subagent session OpenCode reported before the `task` call naming it; kept until it does. */
const MAX_EARLY_EVENTS = 64;
const TASK_TOOL = 'task';
const ABORTED = 'MessageAbortedError';
const TASK_RESULT = /^<task id="([^"]+)" state="([a-z]+)">/;
/** Why OpenCode 1.19 retries when an account limit, not the provider, holds it up. */
const LIMIT_REASONS = new Set(['free_tier_limit', 'account_rate_limit']);

const quiet: HelperNews = { steps: [], workChanged: false };

/**
 * The subagents OpenCode runs in one conversation's session, read from its
 * HTTP API's events: ACP reports a `task` call and its answer, not what the
 * subagent does, nor the end of one working in the background (OpenCode 1.19,
 * `task` with `background: true`). Each subagent works in a session of its
 * own, named by the conversation's `task` tool part.
 */
export class OpenCodeHelpers {
  /** By the subagent's session id. */
  private readonly helpers = new Map<string, Helper>();
  private readonly early = new Map<string, OpenCodeEvent[]>();

  constructor(private readonly parent: () => string) {}

  take(event: OpenCodeEvent): HelperNews {
    const session = sessionOf(event);
    if (!session) return quiet;
    if (session === this.parent()) return this.fromParent(event);
    if (event.type === 'session.created') {
      const info = record(event.properties.info);
      if (info.parentID === this.parent() && !this.helpers.has(session)) this.early.set(session, []);
      return quiet;
    }
    const helper = this.helpers.get(session);
    if (!helper) {
      const kept = this.early.get(session);
      if (kept && kept.length < MAX_EARLY_EVENTS) kept.push(event);
      return quiet;
    }
    return this.fromHelper(helper, event);
  }

  /** What runs in the background now. */
  running(): AgentBackgroundWork[] {
    return [...this.helpers.values()].flatMap((helper) => (helper.background && !helper.done ? [{ id: helper.callId, kind: 'agent' as const, label: helper.label }] : []));
  }

  /** Whether the subagent of the `task` call `callId` works in the background. */
  inBackground(callId: string): boolean {
    for (const helper of this.helpers.values()) if (helper.callId === callId) return helper.background;
    return false;
  }

  /** The session of the background subagent `workId` that still works, marked as being stopped by the person. */
  stop(workId: string): string | undefined {
    for (const [session, helper] of this.helpers) {
      if (helper.callId !== workId || !helper.background || helper.done) continue;
      helper.stopping = true;
      return session;
    }
    return undefined;
  }

  /** Stopping it failed: its end is reported as it comes. */
  unstop(workId: string): void {
    for (const helper of this.helpers.values()) if (helper.callId === workId) helper.stopping = false;
  }

  /** The OpenCode running them is gone, and they with it. */
  clear(): void {
    this.helpers.clear();
    this.early.clear();
  }

  private fromParent(event: OpenCodeEvent): HelperNews {
    if (event.type === 'session.status') {
      const status = record(event.properties.status);
      if (status.type === 'retry') return { ...quiet, status: 'busy', ...(LIMIT_REASONS.has(String(record(status.action).reason)) ? { limitReached: true as const } : {}) };
      return status.type === 'idle' || status.type === 'busy' ? { ...quiet, status: status.type } : quiet;
    }
    if (event.type !== 'message.part.updated') return quiet;
    const part = record(event.properties.part);
    if (part.type === 'tool' && part.tool === TASK_TOOL && typeof part.callID === 'string') return this.named(part.callID, record(part.state));
    if (part.type === 'text' && part.synthetic === true && typeof part.text === 'string') {
      const result = TASK_RESULT.exec(part.text);
      const helper = result?.[1] ? this.helpers.get(result[1]) : undefined;
      if (helper?.background) return { ...quiet, finished: { workId: helper.callId, label: helper.label, failed: result?.[2] !== 'completed' } };
    }
    return quiet;
  }

  /** The conversation's `task` call names its subagent's session once it runs. */
  private named(callId: string, state: Record<string, unknown>): HelperNews {
    const metadata = record(state.metadata);
    const session = typeof metadata.sessionId === 'string' ? metadata.sessionId : undefined;
    if (!session || this.helpers.has(session)) return quiet;
    const input = record(state.input);
    const label = text(input.description) ?? text(state.title) ?? 'subagent';
    const background = metadata.background === true || input.background === true;
    const helper: Helper = { callId, label, background, said: '', error: undefined, stopping: false, done: false, shownTools: new Set(), shownTexts: new Set() };
    this.helpers.set(session, helper);
    const early = this.early.get(session) ?? [];
    this.early.delete(session);
    const steps = early.flatMap((event) => this.fromHelper(helper, event).steps);
    return { ...quiet, steps, workChanged: background };
  }

  private fromHelper(helper: Helper, event: OpenCodeEvent): HelperNews {
    if (helper.done) return quiet;
    if (event.type === 'session.error') {
      const error = record(event.properties.error);
      if (error.name === ABORTED) helper.stopping = true;
      else helper.error = text(record(error.data).message) ?? text(error.name) ?? 'the subagent failed';
      return quiet;
    }
    if (event.type === 'session.status') {
      // A subagent the turn waits for ends with its `task` call, which ACP reports.
      if (record(event.properties.status).type !== 'idle' || !helper.background) return quiet;
      helper.done = true;
      const end: AgentStepEvent = helper.stopping
        ? { type: 'subagent_completed', id: helper.callId, text: helper.said, stopped: true }
        : { type: 'subagent_completed', id: helper.callId, text: helper.said, ...(helper.error ? { error: helper.error } : {}) };
      return { ...quiet, steps: [end], workChanged: true };
    }
    if (event.type !== 'message.part.updated') return quiet;
    const part = record(event.properties.part);
    const partId = text(part.id);
    if (!partId) return quiet;
    if (part.type === 'tool' && typeof part.tool === 'string') {
      const state = record(part.state);
      const input = record(state.input);
      if (helper.shownTools.has(partId) || state.status === 'pending' || Object.keys(input).length === 0) return quiet;
      helper.shownTools.add(partId);
      const shown = shownCall(part.tool, undefined, input);
      return { ...quiet, steps: [{ type: 'subagent_tool_call', id: helper.callId, name: shown.name, input: shown.input }] };
    }
    // What the subagent said, once a part of it is finished; its task, the first message of its session, has no time.
    if (part.type === 'text' && part.synthetic !== true && record(part.time).end !== undefined) {
      const said = text(part.text)?.trim();
      if (!said || helper.shownTexts.has(partId)) return quiet;
      helper.shownTexts.add(partId);
      helper.said = said;
      return { ...quiet, steps: [{ type: 'subagent_message', id: helper.callId, text: said }] };
    }
    return quiet;
  }
}

function sessionOf(event: OpenCodeEvent): string | undefined {
  const { sessionID } = event.properties;
  if (typeof sessionID === 'string') return sessionID;
  const fromPart = record(event.properties.part).sessionID;
  return typeof fromPart === 'string' ? fromPart : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
