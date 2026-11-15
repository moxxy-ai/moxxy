import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { Onboarding } from './Onboarding';

const prefsState = vi.hoisted(() => ({
  onboardingComplete: true,
  update: vi.fn(async () => undefined),
}));

// The host answers that this launch has nothing to set up.
beforeEach(() => {
  __setApiOverride({
    invoke: async (cmd: string) => (cmd === 'app.setup' ? { reason: null, phase: 'done', steps: [], notes: [] } : undefined),
    subscribe: () => () => undefined,
  } as never);
});
afterEach(() => {
  __setApiOverride(null);
});

vi.mock('@moxxy/client-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moxxy/client-core')>();
  return {
    ...actual,
    usePrefs: () => ({
      prefs: { onboardingComplete: prefsState.onboardingComplete },
      loading: false,
      update: prefsState.update,
    }),
    useOnboarding: () => ({
      status: {
        cliInstalled: true,
        cliPath: '/usr/local/bin/moxxy',
        hasProvider: false,
        activeProvider: null,
      },
      node: { installed: true, version: 'v20.0.0' },
      installNode: { running: false, progress: [], error: null, run: async () => true },
    }),
  };
});

vi.mock('./steps/StartStep', () => ({
  StartStep: ({ onDone, onSkip }: { readonly onDone: () => void; readonly onSkip: () => void }) => (
    <>
      <button type="button" onClick={onDone}>
        Connected
      </button>
      <button type="button" onClick={onSkip}>
        Skip for now
      </button>
    </>
  ),
}));

const PROVIDER_RECOVERY_PHASE: ConnectionPhase = {
  phase: 'connected',
  socket: '/tmp/provider-recovery.sock',
  sessionId: 'provider-recovery-session',
  activeProvider: null,
  activeMode: 'default',
};

describe('Onboarding first run', () => {
  beforeEach(() => {
    prefsState.onboardingComplete = false;
    prefsState.update.mockClear();
  });
  afterEach(() => {
    prefsState.onboardingComplete = true;
  });

  it('opens on the start question, with no welcome screen before it', () => {
    render(<Onboarding onComplete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Connected' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Let’s go/ })).toBeNull();
  });

  it('goes straight into the app once connected, and remembers setup is done', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Connected' }));

    expect(prefsState.update).toHaveBeenCalledWith({ onboardingComplete: true });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('lets a first run be finished later without asking for a folder', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(prefsState.update).toHaveBeenCalledWith({ onboardingComplete: true });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/workspace/i)).toBeNull();
  });
});

describe('Onboarding provider recovery', () => {
  it('dismisses the one-step recovery flow when Skip for now is clicked', () => {
    const onComplete = vi.fn();
    render(<Onboarding phase={PROVIDER_RECOVERY_PHASE} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
