import { describe, expect, it } from 'vitest';
import { applyContextConfig, type ContextTarget } from './context-config.js';

const target = (): ContextTarget => ({
  elisionSettings: null,
  lazyTools: undefined,
  unfinishedStepCheck: undefined,
  loopGuard: undefined,
  reasoning: undefined,
  fast: false,
});

describe('applyContextConfig', () => {
  it('carries the reasoning effort from the config onto a new session', () => {
    const session = target();

    applyContextConfig(session, { reasoning: { effort: 'xhigh' } });

    expect(session.reasoning).toEqual({ effort: 'xhigh' });
  });

  it('turns on fast mode from the config', () => {
    const session = target();

    applyContextConfig(session, { fast: true });

    expect(session.fast).toBe(true);
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

  it('switches off the reminder about a step that did not get done, and leaves it on when the config says nothing', () => {
    const off = target();
    const unset = target();

    applyContextConfig(off, { unfinishedStepCheck: false });
    applyContextConfig(unset, { fast: true });

    expect(off.unfinishedStepCheck).toBe(false);
    expect(unset.unfinishedStepCheck).toBeUndefined();
  });

  it('leaves the session as it was without a context block', () => {
    const session = target();

    applyContextConfig(session, undefined);

    expect(session).toEqual(target());
  });
});
