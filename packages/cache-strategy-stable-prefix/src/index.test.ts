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
});
