/**
 * CliStep renderer tests. CliStep was consolidated onto the shared
 * `useOnboarding().install` controller (the same one NodeStep uses), so these
 * exercise that path end-to-end via a faked IPC transport:
 *   1. A present CLI shows the ready state and enables Continue.
 *   2. A missing CLI shows the install panel; clicking Install drives
 *      `onboarding.installMoxxyCli` and reflects the streamed progress.
 *   3. A failed install (non-zero npm exit) surfaces the `npm exit N` error
 *      and a Try again button.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { OnboardingStatus } from '@moxxy/desktop-ipc-contract';
import { CliStep } from './CliStep';

interface FakeOpts {
  readonly cliInstalled: boolean;
  /** Exit code returned by onboarding.installMoxxyCli. */
  readonly installExit?: number;
  /** Drive the CLI from missing → installed once install completes. */
  readonly installResolvesInstalled?: boolean;
}

interface ProgressSub {
  emit(line: string): void;
}

function installFakeApi(opts: FakeOpts): { invokes: string[]; progress: ProgressSub } {
  const invokes: string[] = [];
  let installed = opts.cliInstalled;
  let progressListener: ((line: string) => void) | null = null;

  const status = (): OnboardingStatus => ({
    cliInstalled: installed,
    cliPath: installed ? '/usr/local/bin/moxxy' : null,
    hasProvider: false,
    activeProvider: null,
  });

  __setApiOverride({
    invoke: ((channel: string) => {
      invokes.push(channel);
      if (channel === 'onboarding.status') return Promise.resolve(status());
      if (channel === 'onboarding.probeNode') {
        return Promise.resolve({ installed: true, version: 'v20.0.0' });
      }
      if (channel === 'onboarding.installMoxxyCli') {
        const code = opts.installExit ?? 0;
        if (code === 0 && (opts.installResolvesInstalled ?? true)) installed = true;
        return Promise.resolve(code);
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string, cb: (line: string) => void) => {
      if (channel === 'onboarding.install.progress') progressListener = cb;
      return () => {
        progressListener = null;
      };
    }) as never,
  } as never);

  return {
    invokes,
    progress: {
      emit(line) {
        act(() => progressListener?.(line));
      },
    },
  };
}

afterEach(() => {
  __setApiOverride(null);
});

describe('CliStep', () => {
  it('shows the ready state and enables Continue when the CLI is present', async () => {
    installFakeApi({ cliInstalled: true });
    render(<CliStep onNext={() => {}} onBack={() => {}} />);
    expect(await screen.findByText(/moxxy is installed and ready/i)).toBeTruthy();
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(false);
  });

  it('drives onboarding.installMoxxyCli on click and reflects streamed progress', async () => {
    const fake = installFakeApi({ cliInstalled: false });
    render(<CliStep onNext={() => {}} onBack={() => {}} />);

    // Missing → install panel + disabled Continue.
    const installBtn = await screen.findByRole('button', { name: 'Install moxxy' });
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);

    fireEvent.click(installBtn);

    // Progress streamed through the controller's subscription renders in the log.
    fake.progress.emit('npm: fetching moxxy…');
    await waitFor(() => {
      expect(fake.invokes).toContain('onboarding.installMoxxyCli');
      expect(screen.getByText(/npm: fetching moxxy/i)).toBeTruthy();
    });

    // run() refreshes status → CLI now present → ready + Continue enabled.
    await waitFor(() => {
      expect(screen.getByText(/moxxy is installed and ready/i)).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('surfaces a non-zero npm exit as a failure with a Try again button', async () => {
    installFakeApi({ cliInstalled: false, installExit: 7, installResolvesInstalled: false });
    render(<CliStep onNext={() => {}} onBack={() => {}} />);

    const installBtn = await screen.findByRole('button', { name: 'Install moxxy' });
    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(screen.getByText(/install failed/i)).toBeTruthy();
      expect(screen.getByText('npm exit 7')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    });
  });
});
