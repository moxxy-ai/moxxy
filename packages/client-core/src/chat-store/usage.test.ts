import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { EMPTY_USAGE, PER_CALL_CAP, recordUsage } from './usage.js';

type ProviderResponse = Extract<MoxxyEvent, { type: 'provider_response' }>;

let n = 0;
function providerResponse(usage: Partial<ProviderResponse>): ProviderResponse {
  n += 1;
  return {
    type: 'provider_response',
    id: `e${n}`,
    seq: n,
    ts: n,
    sessionId: 's',
    turnId: 't',
    source: 'model',
    provider: 'p',
    model: 'm',
    ...usage,
  } as unknown as ProviderResponse;
}

describe('recordUsage', () => {
  it('returns null (no re-render) for a usage-less response', () => {
    expect(recordUsage(EMPTY_USAGE, providerResponse({}))).toBeNull();
  });

  it('folds prompt + output token counts cumulatively', () => {
    let u = EMPTY_USAGE;
    u = recordUsage(u, providerResponse({ inputTokens: 100, outputTokens: 20 }))!;
    u = recordUsage(u, providerResponse({ inputTokens: 50, cacheReadTokens: 10, outputTokens: 5 }))!;
    expect(u.calls).toBe(2);
    expect(u.totalInput).toBe(150);
    expect(u.totalCacheRead).toBe(10);
    expect(u.totalOutput).toBe(25);
    // latestPrompt = input + cacheRead + cacheCreation of the last prompt-bearing call.
    expect(u.latestPrompt).toBe(60);
    expect(u.perCall).toEqual([100, 60]);
  });

  it('counts an output-only call without growing perCall', () => {
    let u = EMPTY_USAGE;
    u = recordUsage(u, providerResponse({ inputTokens: 100 }))!;
    const beforeLen = u.perCall.length;
    u = recordUsage(u, providerResponse({ outputTokens: 12 }))!;
    expect(u.calls).toBe(2);
    expect(u.totalOutput).toBe(12);
    // No prompt tokens → no new sparkline point, latestPrompt unchanged.
    expect(u.perCall.length).toBe(beforeLen);
    expect(u.latestPrompt).toBe(100);
  });

  it('caps perCall at PER_CALL_CAP (head-evict) while totals fold every call', () => {
    let u = EMPTY_USAGE;
    const calls = PER_CALL_CAP + 50;
    for (let i = 0; i < calls; i += 1) {
      // distinct prompt size per call so we can assert the retained window.
      u = recordUsage(u, providerResponse({ inputTokens: i + 1 }))!;
    }
    // perCall is bounded; the OLDEST entries were evicted, newest kept.
    expect(u.perCall).toHaveLength(PER_CALL_CAP);
    expect(u.perCall[u.perCall.length - 1]).toBe(calls); // last prompt = calls
    expect(u.perCall[0]).toBe(calls - PER_CALL_CAP + 1); // first retained entry
    // Cumulative counters reflect ALL calls — trimming perCall is lossless.
    expect(u.calls).toBe(calls);
    const expectedTotal = (calls * (calls + 1)) / 2;
    expect(u.totalInput).toBe(expectedTotal);
    expect(u.latestPrompt).toBe(calls);
  });
});
