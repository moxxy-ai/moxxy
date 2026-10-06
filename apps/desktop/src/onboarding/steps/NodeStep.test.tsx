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
      if (channel === 'onboarding.installNode') return Promise.resolve({ ok: false, version: null });
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
  it('installs the runtime once, on its own, and subscribes to its progress once', async () => {
    const fake = installFakeApi();
    render(<Onboarding onComplete={() => {}} phase={{ phase: 'cli-missing' } as never} />);

    // The step never asks the person to install anything or names the runtime.
    await waitFor(() => {
      expect(screen.getByText(/Getting Moxxy ready/i)).toBeTruthy();
    });
    expect(screen.queryByText(/Install automatically/i)).toBeNull();
    expect(screen.queryByText(/Node\.js/i)).toBeNull();

    // The failed install is reported with a way to retry — and is not retried by itself.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
    });

    // One onboarding instance ⇒ one install, one progress subscription, and
    // one probe pair on mount plus the one re-check after the install.
    const count = (list: string[], name: string): number => list.filter((c) => c === name).length;
    expect(count(fake.invokes, 'onboarding.installNode')).toBe(1);
    expect(count(fake.invokes, 'onboarding.probeNode')).toBe(2);
    expect(count(fake.invokes, 'onboarding.status')).toBe(2);
    expect(count(fake.subscribes, 'onboarding.install.progress')).toBe(1);
  });
});
