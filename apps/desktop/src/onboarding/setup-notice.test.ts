/**
 * While onboarding, the person learns that Moxxy is still setting up in the
 * background, and what waits for it, instead of a sign-in or a new workspace
 * that seems to hang.
 */
import { describe, expect, it } from 'vitest';
import type { AppSetupState } from '@moxxy/desktop-ipc-contract';
import { setupNotice } from './setup-notice';

const firstRun = (steps: AppSetupState['steps'], phase: AppSetupState['phase'] = 'running'): AppSetupState => ({
  reason: 'install',
  phase,
  steps,
  notes: [],
});

describe('setupNotice', () => {
  it('names the step being set up, how far along it is, and what waits for it', () => {
    const setup = firstRun([
      { id: 'extensions', status: 'done' },
      { id: 'components', status: 'running' },
      { id: 'connections', status: 'pending' },
    ]);

    expect(setupNotice(setup)).toBe(
      'Moxxy is still setting up: Agent runtime (2 of 3). Signing in and starting the agent wait until it is done.',
    );
  });

  it('names the next step while none runs yet', () => {
    const setup = firstRun(
      [
        { id: 'extensions', status: 'pending' },
        { id: 'connections', status: 'pending' },
      ],
      'pending',
    );

    expect(setupNotice(setup)).toBe(
      'Moxxy is still setting up: Extensions and tools (1 of 2). Signing in and starting the agent wait until it is done.',
    );
  });

  it('says nothing once setup is done, when there is none, or before the host has said', () => {
    expect(setupNotice(firstRun([{ id: 'extensions', status: 'done' }], 'done'))).toBeNull();
    expect(setupNotice({ reason: null, phase: 'done', steps: [], notes: [] })).toBeNull();
    expect(setupNotice(null)).toBeNull();
  });
});
