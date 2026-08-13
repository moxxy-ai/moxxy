import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Onboarding } from './Onboarding';

vi.mock('@moxxy/client-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moxxy/client-core')>();
  return {
    ...actual,
    usePrefs: () => ({
      prefs: { onboardingComplete: true },
      loading: false,
      update: vi.fn(),
    }),
    useOnboarding: () => ({
      status: {
        cliInstalled: true,
        cliPath: '/usr/local/bin/moxxy',
        hasProvider: false,
        activeProvider: null,
      },
      node: { installed: true, version: 'v20.0.0' },
    }),
  };
});

vi.mock('./steps/ProviderStep', () => ({
  ProviderStep: ({ onNext }: { readonly onNext: () => void }) => (
    <button type="button" onClick={onNext}>
      Skip for now
    </button>
  ),
}));

const PROVIDER_RECOVERY_PHASE: ConnectionPhase = {
  phase: 'connected',
  socket: '/tmp/provider-recovery.sock',
  sessionId: 'provider-recovery-session',
  activeProvider: null,
  activeMode: 'default',
};

describe('Onboarding provider recovery', () => {
  it('dismisses the one-step recovery flow when Skip for now is clicked', () => {
    const onComplete = vi.fn();
    render(<Onboarding phase={PROVIDER_RECOVERY_PHASE} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
