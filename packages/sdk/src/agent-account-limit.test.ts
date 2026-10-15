import { describe, expect, it } from 'vitest';
import {
  AGENT_ACCOUNT_LIMIT_SUBTYPE,
  accountLimitInForce,
  accountLimitOfEvent,
  recordedAccountLimit,
  sameAccountLimit,
  withKnownReset,
  type AgentAccountLimit,
} from './agent-account-limit.js';
import { AGENT_CONNECTION_PLUGIN_ID } from './agent-step.js';
import type { MoxxyEvent } from './events.js';

function recorded(provider: string, limit: AgentAccountLimit, agent?: string): MoxxyEvent {
  return {
    type: 'plugin_event',
    pluginId: AGENT_CONNECTION_PLUGIN_ID,
    subtype: AGENT_ACCOUNT_LIMIT_SUBTYPE,
    payload: { provider, ...(agent ? { agent } : {}), limit },
  } as unknown as MoxxyEvent;
}

const HOUR = 3_600_000;

describe('recordedAccountLimit', () => {
  it('reads the last limit recorded for the provider', () => {
    const events = [
      recorded('claude-agent', { state: 'near', usedPercent: 80 }),
      recorded('codex-agent', { state: 'ok', usedPercent: 10 }),
      recorded('claude-agent', { state: 'reached', resetsAt: 5 * HOUR }),
    ];
    expect(recordedAccountLimit(events, 'claude-agent')).toEqual({ provider: 'claude-agent', limit: { state: 'reached', resetsAt: 5 * HOUR } });
    expect(recordedAccountLimit(events, 'codex-agent')).toEqual({ provider: 'codex-agent', limit: { state: 'ok', usedPercent: 10 } });
    expect(recordedAccountLimit(events, 'opencode')).toBeUndefined();
  });
});

describe('accountLimitOfEvent', () => {
  it('reads the limit and whose it is from the event that records it, and nothing from any other', () => {
    expect(accountLimitOfEvent(recorded('claude-agent', { state: 'reached' }, 'Claude'))).toEqual({
      provider: 'claude-agent',
      agent: 'Claude',
      limit: { state: 'reached' },
    });
    expect(accountLimitOfEvent({ type: 'plugin_event', pluginId: AGENT_CONNECTION_PLUGIN_ID, subtype: 'goal_status', payload: {} } as unknown as MoxxyEvent)).toBeUndefined();
  });
});

describe('accountLimitInForce', () => {
  it('holds a reached or near limit until its window resets', () => {
    const reached = { provider: 'claude-agent', limit: { state: 'reached', resetsAt: 5 * HOUR } } as const;
    expect(accountLimitInForce(reached, 4 * HOUR)).toBe(reached);
    expect(accountLimitInForce(reached, 5 * HOUR)).toBeUndefined();
    const near = { provider: 'claude-agent', limit: { state: 'near', usedPercent: 92 } } as const;
    expect(accountLimitInForce(near, 4 * HOUR)).toBe(near);
  });

  it('says nothing about a limit with room left', () => {
    expect(accountLimitInForce({ provider: 'codex-agent', limit: { state: 'ok', usedPercent: 10 } }, 0)).toBeUndefined();
    expect(accountLimitInForce(undefined, 0)).toBeUndefined();
  });
});

describe('sameAccountLimit', () => {
  it('ignores what a person would not see change: a fraction of a percent, seconds of the reset', () => {
    const limit: AgentAccountLimit = { state: 'near', usedPercent: 91.2, resetsAt: 5 * HOUR, windowMinutes: 10080 };
    expect(sameAccountLimit(limit, { ...limit, usedPercent: 91.4, resetsAt: 5 * HOUR + 20_000 })).toBe(true);
    expect(sameAccountLimit(limit, { ...limit, usedPercent: 92 })).toBe(false);
    expect(sameAccountLimit(limit, { ...limit, state: 'reached' })).toBe(false);
    expect(sameAccountLimit(undefined, limit)).toBe(false);
  });
});

describe('a used-up limit reported without its reset', () => {
  const now = 1_000_000;
  const weekly = { state: 'reached', windowMinutes: 10080, resetsAt: now + 60_000 } as const;

  it('keeps the reset known before while it lies ahead', () => {
    expect(withKnownReset({ state: 'reached' }, weekly, now)).toEqual(weekly);
  });

  it('stays as the agent said once that reset has passed, or when the agent gave its own', () => {
    expect(withKnownReset({ state: 'reached' }, weekly, now + 120_000)).toEqual({ state: 'reached' });
    expect(withKnownReset({ state: 'reached', resetsAt: now + 5 }, weekly, now)).toEqual({ state: 'reached', resetsAt: now + 5 });
    expect(withKnownReset({ state: 'near', usedPercent: 80 }, weekly, now)).toEqual({ state: 'near', usedPercent: 80 });
  });
});
