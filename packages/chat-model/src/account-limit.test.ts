import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { accountLimitText, conversationAccountLimit, conversationAccountUsage } from './account-limit.js';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
/** Monday 12 October 2026, 14:00 local time. */
const NOW = at(12, 14);

function recorded(limit: Record<string, unknown>, provider = 'claude-agent', agent: string | undefined = 'Claude'): MoxxyEvent {
  return {
    type: 'plugin_event',
    pluginId: '@moxxy/agent-connection',
    subtype: 'account_limit',
    payload: { provider, ...(agent ? { agent } : {}), limit },
  } as unknown as MoxxyEvent;
}

describe('accountLimitText', () => {
  it('says whose limit is used up, which one, and when it comes back', () => {
    expect(accountLimitText({ provider: 'p', agent: 'Claude', limit: { state: 'reached', windowMinutes: 300, resetsAt: at(12, 18) } }, NOW)).toBe(
      "Claude's 5-hour limit is used up · resets at 18:00",
    );
    expect(accountLimitText({ provider: 'p', agent: 'Codex', limit: { state: 'reached', windowMinutes: 10080, resetsAt: at(13, 9, 30) } }, NOW)).toBe(
      "Codex's weekly limit is used up · resets tomorrow at 09:30",
    );
    expect(accountLimitText({ provider: 'p', agent: 'Codex', limit: { state: 'reached', windowMinutes: 10080, resetsAt: at(16, 9) } }, NOW)).toBe(
      "Codex's weekly limit is used up · resets Fri at 09:00",
    );
    expect(accountLimitText({ provider: 'p', agent: 'Codex', limit: { state: 'reached', resetsAt: at(25, 9) } }, NOW)).toBe(
      "Codex's usage limit is used up · resets 25 Oct at 09:00",
    );
  });

  it('says how much is used when the limit is near', () => {
    expect(accountLimitText({ provider: 'p', agent: 'Claude', limit: { state: 'near', usedPercent: 92, windowMinutes: 10080, resetsAt: at(16, 21) } }, NOW)).toBe(
      'Claude has used 92% of its weekly limit · resets Fri at 21:00',
    );
    expect(accountLimitText({ provider: 'p', limit: { state: 'near' } }, NOW)).toBe('The agent is close to its usage limit');
  });

  it('leaves out the reset when the agent did not say it', () => {
    expect(accountLimitText({ provider: 'p', agent: 'Claude', limit: { state: 'reached' } }, NOW)).toBe("Claude's usage limit is used up");
  });
});

describe('conversationAccountLimit', () => {
  it('is the limit the active agent last reported, while it holds', () => {
    const events = [recorded({ state: 'reached', resetsAt: at(12, 18) }), recorded({ state: 'ok' }, 'codex-agent', 'Codex')];

    expect(conversationAccountLimit(events, 'claude-agent', NOW)).toEqual({
      provider: 'claude-agent',
      agent: 'Claude',
      limit: { state: 'reached', resetsAt: at(12, 18) },
    });
    expect(conversationAccountLimit(events, 'claude-agent', at(12, 18))).toBeUndefined();
    expect(conversationAccountLimit(events, 'codex-agent', NOW)).toBeUndefined();
    expect(conversationAccountLimit(events, null, NOW)).toBeUndefined();
  });
});

describe('conversationAccountUsage', () => {
  it('is how much of its limit the active agent last said it used, until that window resets', () => {
    const events = [recorded({ state: 'ok', usedPercent: 56, windowMinutes: 10080, resetsAt: at(14, 5) })];

    expect(conversationAccountUsage(events, 'claude-agent', NOW)).toEqual({
      provider: 'claude-agent',
      agent: 'Claude',
      limit: { state: 'ok', usedPercent: 56, windowMinutes: 10080, resetsAt: at(14, 5) },
    });
    expect(conversationAccountUsage(events, 'claude-agent', at(14, 5))).toBeUndefined();
    expect(conversationAccountUsage(events, 'codex-agent', NOW)).toBeUndefined();
  });

  it('says nothing for a limit that is fine and came without a number', () => {
    expect(conversationAccountUsage([recorded({ state: 'ok' })], 'claude-agent', NOW)).toBeUndefined();
    expect(conversationAccountUsage([recorded({ state: 'reached' })], 'claude-agent', NOW)?.limit.state).toBe('reached');
  });
});
