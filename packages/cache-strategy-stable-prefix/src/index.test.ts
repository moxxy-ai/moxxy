import { describe, expect, it } from 'vitest';
import type { CacheStrategyContext, ProviderMessage } from '@moxxy/sdk';
import { createStablePrefixCacheStrategy, createNoCacheStrategy } from './index.js';

const strategy = createStablePrefixCacheStrategy();

const msgs: ProviderMessage[] = [
  { role: 'system', content: [{ type: 'text', text: 'sys' }] },
  { role: 'user', content: [{ type: 'text', text: 'a' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
  { role: 'user', content: [{ type: 'text', text: 'c' }] },
];

const ctx = (over: Partial<CacheStrategyContext> = {}): CacheStrategyContext => ({
  model: 'm',
  contextWindow: 200_000,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  ...over,
});

describe('stable-prefix cache strategy', () => {
  it('marks tools, system, and the rolling tail', () => {
    const hints = strategy.plan(msgs, ctx());
    expect(hints).toContainEqual({ target: 'tools' });
    expect(hints).toContainEqual({ target: 'system' });
    expect(hints).toContainEqual({ target: { messageIndex: 3 } }); // last non-system
  });

  it('adds a long-lived stable-prefix breakpoint when given one, within Anthropic 4-limit', () => {
    const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: 1 }));
    expect(hints).toContainEqual({ target: { messageIndex: 1 } });
    expect(hints).toContainEqual({ target: { messageIndex: 3 } });
    expect(hints.length).toBeLessThanOrEqual(4);
  });

  it('does not duplicate when the stable index equals the tail', () => {
    const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: 3 }));
    const msgHints = hints.filter((h) => typeof h.target === 'object');
    expect(msgHints).toHaveLength(1);
  });

  it('is deterministic', () => {
    expect(strategy.plan(msgs, ctx())).toEqual(strategy.plan(msgs, ctx()));
  });

  it('emits no message breakpoint when only a system prompt exists', () => {
    const hints = strategy.plan([msgs[0]!], ctx());
    expect(hints.every((h) => h.target === 'tools' || h.target === 'system')).toBe(true);
  });

  it('none strategy emits no breakpoints', () => {
    expect(createNoCacheStrategy().plan(msgs, ctx())).toEqual([]);
  });

  it('places the tail breakpoint before a volatile trailing message (goal-mode nudge)', () => {
    const withNudge: ProviderMessage[] = [
      ...msgs,
      { role: 'user', content: [{ type: 'text', text: 'You stopped — continue or call goal_complete.' }] },
    ];
    const hints = strategy.plan(withNudge, ctx({ volatileTailMessageCount: 1 }));
    expect(hints).toContainEqual({ target: { messageIndex: 3 } }); // last STABLE message
    expect(hints).not.toContainEqual({ target: { messageIndex: 4 } }); // never the nudge
  });

  it('keeps the tail breakpoint stable across two goal iterations whose only difference is the nudge', () => {
    // Iteration N: the model idled — projection ends with its assistant
    // message, no nudge.
    const iterationA: ProviderMessage[] = [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { role: 'user', content: [{ type: 'text', text: 'the goal' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'idle reply, no tools' }] },
    ];
    // Iteration N+1: identical log projection plus the volatile nudge
    // appended as the trailing user message.
    const iterationB: ProviderMessage[] = [
      ...iterationA,
      { role: 'user', content: [{ type: 'text', text: 'You stopped — continue or call goal_complete.' }] },
    ];
    const planA = strategy.plan(iterationA, ctx());
    const planB = strategy.plan(iterationB, ctx({ volatileTailMessageCount: 1 }));
    // Same breakpoints byte-for-byte: the prefix cached in iteration N is the
    // exact prefix read back in iteration N+1 — no wasted cache write on the
    // nudge.
    expect(planB).toEqual(planA);
    expect(planB).toContainEqual({ target: { messageIndex: 2 } });
  });

  it('without the volatile-tail hint the nudge still gets the (legacy) tail breakpoint', () => {
    const withNudge: ProviderMessage[] = [
      ...msgs,
      { role: 'user', content: [{ type: 'text', text: 'nudge' }] },
    ];
    expect(strategy.plan(withNudge, ctx())).toContainEqual({ target: { messageIndex: 4 } });
  });

  it('never places a stable-prefix breakpoint on a system message', () => {
    // index 0 is the system prompt; the Anthropic translator silently drops a
    // cache_control on it, so the strategy must not emit one there.
    const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: 0 }));
    expect(hints).not.toContainEqual({ target: { messageIndex: 0 } });
    const msgHints = hints.filter((h) => typeof h.target === 'object');
    expect(msgHints).toEqual([{ target: { messageIndex: 3 } }]); // tail only
  });

  it('ignores a negative stablePrefixMessageIndex', () => {
    const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: -1 }));
    const msgHints = hints.filter((h) => typeof h.target === 'object');
    expect(msgHints).toEqual([{ target: { messageIndex: 3 } }]); // tail only
  });

  it('ignores a non-integer stablePrefixMessageIndex (the translator drops it)', () => {
    // A fractional index passes the >= 0 / < tail range checks but points at no
    // real message position; the Anthropic translator matches hints against
    // integer indices, so { messageIndex: 1.5 } would be silently dropped —
    // the strategy must never emit it.
    for (const bad of [1.5, 0.1, 2.999]) {
      const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: bad }));
      const msgHints = hints.filter((h) => typeof h.target === 'object');
      expect(msgHints).toEqual([{ target: { messageIndex: 3 } }]); // tail only
    }
  });

  it('ignores a non-finite stablePrefixMessageIndex (NaN / Infinity)', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const hints = strategy.plan(msgs, ctx({ stablePrefixMessageIndex: bad }));
      const msgHints = hints.filter((h) => typeof h.target === 'object');
      expect(msgHints).toEqual([{ target: { messageIndex: 3 } }]); // tail only
    }
  });

  it('emits only tools/system when the volatile tail exceeds the message count', () => {
    const hints = strategy.plan(msgs, ctx({ volatileTailMessageCount: 99 }));
    expect(hints).toEqual([{ target: 'tools' }, { target: 'system' }]);
  });

  it('falls back to the true tail when given a malformed (NaN/float) volatile count', () => {
    // NaN must degrade to caching the true tail, not to dropping the breakpoint.
    expect(strategy.plan(msgs, ctx({ volatileTailMessageCount: Number.NaN }))).toContainEqual({
      target: { messageIndex: 3 },
    });
    // A float is truncated toward zero (1.9 → 1 volatile message excluded).
    expect(strategy.plan(msgs, ctx({ volatileTailMessageCount: 1.9 }))).toContainEqual({
      target: { messageIndex: 2 },
    });
  });

  it('stays deterministic under malformed inputs', () => {
    const malformed = ctx({ stablePrefixMessageIndex: 1.5, volatileTailMessageCount: Number.NaN });
    expect(strategy.plan(msgs, malformed)).toEqual(strategy.plan(msgs, malformed));
  });

  it('never exceeds Anthropic 4-breakpoint limit across the input matrix', () => {
    const matrix: Array<Partial<CacheStrategyContext>> = [
      {},
      { stablePrefixMessageIndex: 1 },
      { stablePrefixMessageIndex: 3 },
      { stablePrefixMessageIndex: 0 },
      { stablePrefixMessageIndex: -1 },
      { stablePrefixMessageIndex: 1.5 },
      { stablePrefixMessageIndex: Number.NaN },
      { stablePrefixMessageIndex: Infinity },
      { volatileTailMessageCount: 1 },
      { volatileTailMessageCount: 99 },
      { volatileTailMessageCount: Number.NaN },
      { stablePrefixMessageIndex: 1, volatileTailMessageCount: 1 },
    ];
    for (const over of matrix) {
      expect(strategy.plan(msgs, ctx(over)).length).toBeLessThanOrEqual(4);
    }
  });
});
