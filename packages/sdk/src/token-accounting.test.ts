import { describe, expect, it } from 'vitest';
import {
  addModelTotals,
  asEventId,
  asSessionId,
  asTurnId,
  summarizeSessionTokensFromEvents,
  summarizeTokensByModel,
  type ModelUsageTotals,
  type MoxxyEvent,
} from './index.js';

const sid = asSessionId('s1');
const t1 = asTurnId('t1');

function resp(seq: number, partial: Partial<Extract<MoxxyEvent, { type: 'provider_response' }>>): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    turnId: t1,
    source: 'system',
    type: 'provider_response',
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    ...partial,
  } as MoxxyEvent;
}

describe('summarizeTokensByModel', () => {
  it('groups usage by provider/model and sums fields', () => {
    const byModel = summarizeTokensByModel([
      resp(0, { provider: 'anthropic', model: 'opus', inputTokens: 100, outputTokens: 10 }),
      resp(1, {
        provider: 'anthropic',
        model: 'opus',
        inputTokens: 50,
        outputTokens: 5,
        cacheReadTokens: 200,
        cacheCreationTokens: 30,
      }),
      resp(2, { provider: 'openai', model: 'gpt-5', inputTokens: 80, outputTokens: 8 }),
    ]);

    expect(Object.keys(byModel).sort()).toEqual(['anthropic/opus', 'openai/gpt-5']);
    expect(byModel['anthropic/opus']).toEqual<ModelUsageTotals>({
      calls: 2,
      inputTokens: 150,
      outputTokens: 15,
      cacheReadTokens: 200,
      cacheCreationTokens: 30,
    });
    expect(byModel['openai/gpt-5']!.calls).toBe(1);
  });

  it('keeps the same model id under different providers separate', () => {
    const byModel = summarizeTokensByModel([
      resp(0, { provider: 'a', model: 'm', inputTokens: 1 }),
      resp(1, { provider: 'b', model: 'm', inputTokens: 2 }),
    ]);
    expect(byModel['a/m']!.inputTokens).toBe(1);
    expect(byModel['b/m']!.inputTokens).toBe(2);
  });

  it('skips provider_response events that reported no usage', () => {
    const byModel = summarizeTokensByModel([
      resp(0, { provider: 'a', model: 'm' }), // no token fields
    ]);
    expect(byModel).toEqual({});
  });

  it('ignores non provider_response events', () => {
    const byModel = summarizeTokensByModel([
      { id: asEventId('u'), seq: 0, ts: 0, sessionId: sid, turnId: t1, source: 'user', type: 'user_prompt', text: 'hi' } as MoxxyEvent,
      resp(1, { inputTokens: 5 }),
    ]);
    expect(byModel['anthropic/claude-opus-4-7']!.inputTokens).toBe(5);
  });
});

describe('summarizeSessionTokensFromEvents — cost fold', () => {
  it('counts only responses that reported usage', () => {
    const s = summarizeSessionTokensFromEvents([
      resp(0, {}), // no token fields → not counted
      resp(1, { inputTokens: 100, outputTokens: 10 }),
      resp(2, { cacheReadTokens: 50 }),
    ]);
    expect(s.calls).toBe(2);
    expect(s.totalInput).toBe(100);
    expect(s.totalCacheRead).toBe(50);
    expect(s.totalOutput).toBe(10);
    expect(s.totalPrompt).toBe(150);
  });

  it('applies the read 0.1x / write 1.25x billing multipliers', () => {
    const s = summarizeSessionTokensFromEvents([
      resp(0, { inputTokens: 100, cacheReadTokens: 1000, cacheCreationTokens: 200 }),
    ]);
    // totalPrompt = 100 + 1000 + 200 = 1300 (== uncachedInputEq)
    expect(s.totalPrompt).toBe(1300);
    expect(s.uncachedInputEq).toBe(1300);
    // billedInputEq = 100 + 1000*0.1 + 200*1.25 = 100 + 100 + 250 = 450
    expect(s.billedInputEq).toBeCloseTo(450, 6);
    expect(s.cacheHitRate).toBeCloseTo(1000 / 1300, 6);
    expect(s.savedRatio).toBeCloseTo(1 - 450 / 1300, 6);
  });

  it('guards divide-by-zero when no prompt tokens were reported', () => {
    const s = summarizeSessionTokensFromEvents([resp(0, { outputTokens: 5 })]);
    expect(s.totalPrompt).toBe(0);
    expect(s.cacheHitRate).toBe(0);
    expect(s.savedRatio).toBe(0);
    // No writes → cache considered effective (deliberately-off cache never alarms).
    expect(s.cacheEffective).toBe(true);
  });

  it('reports cacheEffective=true for a healthy cache (high read ratio)', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      resp(i, { inputTokens: 10, cacheReadTokens: 1000, cacheCreationTokens: 100 }),
    );
    const s = summarizeSessionTokensFromEvents(events);
    expect(s.calls).toBe(6);
    expect(s.cacheHitRate).toBeGreaterThan(0.05);
    expect(s.savedRatio).toBeGreaterThan(0);
    expect(s.cacheEffective).toBe(true);
  });

  it('trips cacheEffective=false on broken cache: >=5 calls, writes>0, near-zero reads', () => {
    // 5 calls each writing cache but never reading it → cacheHitRate 0.
    const events = Array.from({ length: 5 }, (_, i) =>
      resp(i, { inputTokens: 100, cacheCreationTokens: 500, cacheReadTokens: 0 }),
    );
    const s = summarizeSessionTokensFromEvents(events);
    expect(s.calls).toBe(5);
    expect(s.totalCacheCreation).toBeGreaterThan(0);
    expect(s.cacheHitRate).toBe(0);
    expect(s.cacheEffective).toBe(false);
  });

  it('exempts the broken-cache trip below 5 calls (boundary at calls===4 vs 5)', () => {
    const make = (n: number) =>
      summarizeSessionTokensFromEvents(
        Array.from({ length: n }, (_, i) =>
          resp(i, { inputTokens: 100, cacheCreationTokens: 500, cacheReadTokens: 0 }),
        ),
      );
    expect(make(4).cacheEffective).toBe(true); // < 5 → exempt
    expect(make(5).cacheEffective).toBe(false); // >= 5 → trips
  });

  it('exempts when there are no cache writes even with zero reads over many calls', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      resp(i, { inputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 }),
    );
    expect(summarizeSessionTokensFromEvents(events).cacheEffective).toBe(true);
  });

  it('does not trip when cacheHitRate sits exactly at the 0.05 threshold', () => {
    // hitRate === 0.05 is NOT < 0.05, so the cache stays effective.
    // read/(input+read+write) = 125 / 2500 = 0.05.
    const events = Array.from({ length: 5 }, (_, i) =>
      resp(i, { inputTokens: 1875, cacheReadTokens: 125, cacheCreationTokens: 500 }),
    );
    const s = summarizeSessionTokensFromEvents(events);
    expect(s.cacheHitRate).toBeCloseTo(0.05, 6);
    expect(s.cacheEffective).toBe(true);
  });
});

describe('addModelTotals', () => {
  it('adds field-wise', () => {
    const a: ModelUsageTotals = { calls: 1, inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 };
    const b: ModelUsageTotals = { calls: 2, inputTokens: 20, outputTokens: 5, cacheReadTokens: 1, cacheCreationTokens: 0 };
    expect(addModelTotals(a, b)).toEqual<ModelUsageTotals>({
      calls: 3,
      inputTokens: 30,
      outputTokens: 7,
      cacheReadTokens: 4,
      cacheCreationTokens: 4,
    });
  });
});
