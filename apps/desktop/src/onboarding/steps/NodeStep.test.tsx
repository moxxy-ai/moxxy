/**
 * Regression test for u9-1: NodeStep used to mount its OWN `useOnboarding()`,
 * so while it was on screen the app held two onboarding states — double the
 * mount probes (`onboarding.probeNode`) and two `onboarding.install.progress`
 * subscriptions. The fix lifts a single instance in `Onboarding` and passes it
 * down, so the node step active = exactly one probe pair + one subscription.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { OnboardingStatus } from '@moxxy/desktop-ipc-contract';
import { Onboarding } from '../Onboarding';

function installFakeApi(): { invokes: string[]; subscribes: string[] } {
  const invokes: string[] = [];
  const subscribes: string[] = [];

  const status = (): OnboardingStatus => ({
    cliInstalled: true,
    cliPath: '/usr/local/bin/moxxy',
    hasProvider: true,
    activeProvider: 'anthropic',
  });

  __setApiOverride({
    invoke: ((channel: string) => {
      invokes.push(channel);
      if (channel === 'prefs.read') return Promise.resolve({ onboardingComplete: true });
      if (channel === 'onboarding.status') return Promise.resolve(status());
      // Node NOT installed → the 'node' step is the unmet prerequisite the
      // recovery gate resolves to. `installed:false` is non-null → nodeProbed.
      if (channel === 'onboarding.probeNode') return Promise.resolve({ installed: false });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string) => {
      subscribes.push(channel);
      return () => {};
    }) as never,
  } as never);

  return { invokes, subscribes };
}

afterEach(() => {
  __setApiOverride(null);
});

describe('NodeStep — single shared useOnboarding instance', () => {
  it('probes node once and subscribes to install progress once while the node step is active', async () => {
    const fake = installFakeApi();
    render(<Onboarding onComplete={() => {}} phase={{ phase: 'cli-missing' } as never} />);

    // The node step's CTA confirms we're on the node step.
    await waitFor(() => {
      expect(screen.getByText(/Install Node\.js/i)).toBeTruthy();
    });

    // One onboarding instance ⇒ one probe pair, one progress subscription.
    const probeCount = fake.invokes.filter((c) => c === 'onboarding.probeNode').length;
    const statusCount = fake.invokes.filter((c) => c === 'onboarding.status').length;
    const progressSubs = fake.subscribes.filter((c) => c === 'onboarding.install.progress').length;

    expect(probeCount).toBe(1);
    expect(statusCount).toBe(1);
    expect(progressSubs).toBe(1);
  });
});
