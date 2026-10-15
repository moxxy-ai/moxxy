import { AGENT_CONNECTION_PLUGIN_ID } from './agent-step.js';
import type { MoxxyEvent } from './events.js';

/**
 * How much of the person's account an agent connection's agent may still use, as the agent
 * reports it (Claude's plan limits, Codex's rate limits). Recorded in the log, so every surface
 * reads the same state.
 */
export interface AgentAccountLimit {
  /** `reached`: the agent does no work until `resetsAt`; `near`: most of the window is used. */
  readonly state: 'ok' | 'near' | 'reached';
  /** When the window resets, in epoch ms, when the agent says. */
  readonly resetsAt?: number;
  /** The window's length in minutes: 300 for five hours, 10080 for a week. */
  readonly windowMinutes?: number;
  /** How much of the window is used, 0–100. */
  readonly usedPercent?: number;
}

/** From how much of a window a limit counts as near, for an agent that does not say so itself (Claude warns from 75%). */
export const ACCOUNT_LIMIT_NEAR_PERCENT = 75;

/** Where an agent connection records its agent's account limit, under `AGENT_CONNECTION_PLUGIN_ID`. */
export const AGENT_ACCOUNT_LIMIT_SUBTYPE = 'account_limit';

export interface RecordedAccountLimit {
  readonly provider: string;
  /** The agent's name ("Claude", "Codex"), for the surfaces to say whose limit it is. */
  readonly agent?: string;
  readonly limit: AgentAccountLimit;
}

/** The last account limit recorded for the provider. */
export function recordedAccountLimit(events: ReadonlyArray<MoxxyEvent>, provider: string): RecordedAccountLimit | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'plugin_event') continue;
    if (event.pluginId !== AGENT_CONNECTION_PLUGIN_ID || event.subtype !== AGENT_ACCOUNT_LIMIT_SUBTYPE) continue;
    const payload = event.payload as Partial<RecordedAccountLimit> | null;
    if (payload && payload.provider === provider && payload.limit) return accountLimitPayload(payload);
  }
  return undefined;
}

/** The limit a plugin event records, or undefined when it records something else. */
export function accountLimitOfEvent(event: MoxxyEvent): RecordedAccountLimit | undefined {
  if (event.type !== 'plugin_event' || event.pluginId !== AGENT_CONNECTION_PLUGIN_ID || event.subtype !== AGENT_ACCOUNT_LIMIT_SUBTYPE) return undefined;
  const payload = event.payload as Partial<RecordedAccountLimit> | null;
  return payload && typeof payload.provider === 'string' && payload.limit ? accountLimitPayload(payload) : undefined;
}

function accountLimitPayload(payload: Partial<RecordedAccountLimit>): RecordedAccountLimit {
  return {
    provider: String(payload.provider),
    ...(typeof payload.agent === 'string' ? { agent: payload.agent } : {}),
    limit: payload.limit as AgentAccountLimit,
  };
}

/** A near or reached limit, until its window resets; a limit with room left says nothing. */
export function accountLimitInForce(recorded: RecordedAccountLimit | undefined, nowMs: number): RecordedAccountLimit | undefined {
  if (!recorded || recorded.limit.state === 'ok') return undefined;
  const { resetsAt } = recorded.limit;
  return resetsAt !== undefined && resetsAt <= nowMs ? undefined : recorded;
}

/** Whether two reports would read the same to the person: whole percents, the reset to the minute. */
export function sameAccountLimit(a: AgentAccountLimit | undefined, b: AgentAccountLimit): boolean {
  if (!a) return false;
  const minute = (ms: number | undefined) => (ms === undefined ? undefined : Math.round(ms / 60_000));
  const percent = (p: number | undefined) => (p === undefined ? undefined : Math.floor(p));
  return (
    a.state === b.state &&
    a.windowMinutes === b.windowMinutes &&
    minute(a.resetsAt) === minute(b.resetsAt) &&
    percent(a.usedPercent) === percent(b.usedPercent)
  );
}

/**
 * A used-up limit the agent reports without its reset (Claude Code's own
 * "You've hit your limit" when its process already said when it resets) keeps
 * the reset known before, while that still lies ahead.
 */
export function withKnownReset(reading: AgentAccountLimit, known: AgentAccountLimit | undefined, nowMs: number): AgentAccountLimit {
  if (reading.state !== 'reached' || reading.resetsAt !== undefined) return reading;
  if (!known || known.resetsAt === undefined || known.resetsAt <= nowMs) return reading;
  return { ...reading, resetsAt: known.resetsAt, ...(known.windowMinutes !== undefined && reading.windowMinutes === undefined ? { windowMinutes: known.windowMinutes } : {}) };
}
