import { describe, expect, it } from 'vitest';
import { resolveFlow } from '@moxxy/client-core';
import { ONBOARDING_STEPS, type OnboardingCtx } from './flow';

const firstRun: OnboardingCtx = {
  full: true,
  cliInstalled: true,
  cliProbed: true,
  hasProvider: false,
  nodeInstalled: true,
  nodeProbed: true,
  cliMissing: false,
};

const ids = (ctx: OnboardingCtx, mode: 'linear' | 'auto'): ReadonlyArray<string> =>
  resolveFlow(ONBOARDING_STEPS, ctx, mode, 0).steps.map((step) => step.id);

describe('the onboarding flow', () => {
  it('asks one question on a first run where everything is in place', () => {
    expect(ids(firstRun, 'linear')).toEqual(['start']);
  });

  it('does not show the install step while the check has not answered yet', () => {
    expect(ids({ ...firstRun, cliInstalled: false, cliProbed: false }, 'linear')).toEqual(['start']);
  });

  it('installs moxxy first only when it is really missing', () => {
    expect(ids({ ...firstRun, cliInstalled: false }, 'linear')).toEqual(['cli', 'start']);
  });

  it('gets the runtime ready first only when it is missing', () => {
    expect(ids({ ...firstRun, nodeInstalled: false }, 'linear')).toEqual(['node', 'start']);
  });

  it('shows only the start question when a provider went missing later', () => {
    const recovery = { ...firstRun, full: false };
    expect(resolveFlow(ONBOARDING_STEPS, recovery, 'auto', 0).currentId).toBe('start');
    expect(ids(recovery, 'auto')).toEqual(['start']);
  });

  it('repairs a missing moxxy before anything else once the app runs', () => {
    const recovery = { ...firstRun, full: false, cliInstalled: false, cliMissing: true };
    expect(resolveFlow(ONBOARDING_STEPS, recovery, 'auto', 0).currentId).toBe('cli');
  });

  it('closes the recovery gate once a provider is active', () => {
    expect(resolveFlow(ONBOARDING_STEPS, { ...firstRun, full: false, hasProvider: true }, 'auto', 0).isComplete).toBe(true);
  });
});
