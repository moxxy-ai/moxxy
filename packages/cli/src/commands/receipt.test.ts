import { describe, it, expect } from 'vitest';
import type { AuditRecord } from '@moxxy/sdk';
import { buildReceipt } from './receipt.js';

function rec(over: Partial<AuditRecord>): AuditRecord {
  return {
    ts: 1_700_000_000_000,
    sessionId: 's1',
    turnId: 't1',
    action: 'tool.request',
    eventType: 'tool_call_requested',
    seq: 0,
    prevHash: '',
    hash: '',
    ...over,
  } as AuditRecord;
}

describe('buildReceipt', () => {
  it('reports the actor, the trigger origin and the policy in force', () => {
    const policy = rec({
      action: 'policy',
      detail: { fingerprint: 'abc123', securityEnabled: true },
    });
    const records = [
      rec({
        action: 'prompt',
        eventType: 'user_prompt',
        actor: { id: 'alice@host', kind: 'human', issuer: 'os' },
        detail: { origin: 'webhook:deploy' },
      }),
    ];

    const r = buildReceipt('t1', records, policy, true);

    expect(r.actor).toBe('os:alice@host');
    expect(r.trigger).toBe('webhook:deploy');
    expect(r.policyFingerprint).toBe('abc123');
  });

  it('names an unattributed run rather than inventing an actor', () => {
    const r = buildReceipt('t1', [rec({ detail: { tool: 'Read' } })], undefined, true);

    expect(r.actor).toBe('unattributed');
    expect(r.policyFingerprint).toBeNull();
  });

  it('separates what was requested from what was denied, and counts failures', () => {
    const records = [
      rec({ detail: { tool: 'Read' } }),
      rec({ detail: { tool: 'Write' } }),
      rec({
        action: 'tool.denied',
        eventType: 'tool_call_denied',
        detail: { tool: 'Bash', reason: 'managed policy' },
      }),
      rec({ action: 'tool.result', eventType: 'tool_result', detail: { ok: false } }),
      rec({ action: 'tool.result', eventType: 'tool_result', detail: { ok: true } }),
    ];

    const r = buildReceipt('t1', records, undefined, true);

    expect(r.toolsRequested).toEqual(['Read', 'Write']);
    expect(r.denials).toEqual([{ tool: 'Bash', reason: 'managed policy' }]);
    expect(r.failures).toBe(1);
  });

  it('sums token cost across every provider response in the run', () => {
    const usage = (i: number, o: number) =>
      rec({
        action: 'usage',
        eventType: 'provider_response',
        detail: { inputTokens: i, outputTokens: o },
      });

    const r = buildReceipt('t1', [usage(1000, 200), usage(500, 80)], undefined, true);

    expect(r.tokens).toEqual({ input: 1500, output: 280 });
  });

  it('carries the chain verdict so a receipt cannot look complete when it is not', () => {
    const records = [rec({ detail: { tool: 'Read' } })];

    expect(buildReceipt('t1', records, undefined, true).chainVerified).toBe(true);
    expect(buildReceipt('t1', records, undefined, false).chainVerified).toBe(false);
  });
});
