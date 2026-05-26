import { describe, expect, it } from 'vitest';
import {
  addModelTotals,
  asEventId,
  asSessionId,
  asTurnId,
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
