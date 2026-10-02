import { describe, expect, it } from 'vitest';
import { applyContextConfig, type ContextTarget } from './context-config.js';

const target = (): ContextTarget => ({
  elisionSettings: null,
  lazyTools: undefined,
  loopGuard: undefined,
  reasoning: undefined,
});

describe('applyContextConfig', () => {
  it('carries the reasoning effort from the config onto a new session', () => {
    const session = target();

    applyContextConfig(session, { reasoning: { effort: 'xhigh' } });

    expect(session.reasoning).toEqual({ effort: 'xhigh' });
  });

  it('carries lazy tools and the loop guard', () => {
    const session = target();

    applyContextConfig(session, { lazyTools: true, loopGuard: { maxIterations: 7 } });

    expect(session.lazyTools).toBe(true);
    expect(session.loopGuard).toEqual({ maxIterations: 7 });
  });

  it('keeps an explicit "off" for lazy tools, so a long tool list does not turn it on', () => {
    const session = target();

    applyContextConfig(session, { lazyTools: false });

    expect(session.lazyTools).toBe(false);
  });

  it('leaves the session as it was without a context block', () => {
    const session = target();

    applyContextConfig(session, undefined);

    expect(session).toEqual(target());
  });
});
