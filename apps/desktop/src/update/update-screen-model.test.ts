import { describe, expect, it } from 'vitest';
import type { AppSetupState, AppUpdatePlan } from '@moxxy/desktop-ipc-contract';
import { runnerState, updateScreenModel, type UpdateScreenInput } from './update-screen-model';

const downloading: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [
    { id: 'app', status: 'running' },
    { id: 'restart', status: 'pending' },
  ],
};
const failed: AppUpdatePlan = {
  ...downloading,
  steps: [
    { id: 'app', status: 'failed', error: 'offline' },
    { id: 'restart', status: 'pending' },
  ],
};
const settingUp: AppSetupState = {
  reason: 'update',
  phase: 'running',
  steps: [
    { id: 'extensions', status: 'done' },
    { id: 'components', status: 'running' },
  ],
  notes: [],
};
const setUp: AppSetupState = {
  ...settingUp,
  phase: 'done',
  steps: [
    { id: 'extensions', status: 'done' },
    { id: 'components', status: 'done' },
  ],
};

const model = (input: Partial<UpdateScreenInput>) =>
  updateScreenModel({ plan: null, progress: null, setup: null, runner: 'starting', onboarded: true, closed: false, ...input });
const steps = (input: Partial<UpdateScreenInput>) => model(input)?.steps.map((step) => `${step.label}:${step.status}`);

describe('updateScreenModel — nothing to show', () => {
  it('stays out of the way on an ordinary launch', () => {
    expect(model({})).toBeNull();
    expect(model({ setup: { reason: null, phase: 'done', steps: [], notes: [] } })).toBeNull();
  });
});

describe('updateScreenModel — the update', () => {
  it('shows the download and the restart ahead of it', () => {
    expect(model({ plan: downloading })).toMatchObject({
      kind: 'updating',
      title: 'Updating Moxxy',
      subtitle: 'Version 0.6.0',
      busy: true,
      actions: [],
    });
    expect(steps({ plan: downloading })).toEqual(['Download the update:running', 'Restart Moxxy:pending']);
  });

  it('says there is nothing for the person to do', () => {
    expect(model({ plan: downloading })?.footer).toMatch(/Nothing for you to do/);
  });

  it('measures the download when its size is known', () => {
    const shown = model({ plan: downloading, progress: { phase: 'download', received: 42, total: 100 } });
    expect(shown?.progress).toBeCloseTo(0.42);
    expect(shown?.steps[0]?.detail).toBe('42%');
  });

  it('shows the bar as moving, not measured, when the size is unknown', () => {
    const shown = model({ plan: downloading, progress: { phase: 'install', message: 'Verifying…' } });
    expect(shown?.progress).toBeNull();
    expect(shown?.steps[0]?.detail).toBe('Verifying…');
  });

  it('names the full installer for what it is', () => {
    const installer: AppUpdatePlan = { ...downloading, route: 'installer', steps: [{ id: 'installer', status: 'done' }, { id: 'restart', status: 'running' }] };
    expect(steps({ plan: installer })).toEqual(['Download the new version:done', 'Install and restart:running']);
  });

  it('says Moxxy still works when the update fails, and offers another try', () => {
    const shown = model({ plan: failed });
    expect(shown).toMatchObject({
      kind: 'failed',
      title: 'The update could not be finished',
      subtitle: 'Moxxy works as before.',
      busy: false,
      actions: ['retry', 'close'],
    });
    expect(shown?.steps[0]).toMatchObject({ status: 'failed', detail: 'offline' });
  });

  it('offers the installer by hand when the system would not take it', () => {
    const refused: AppUpdatePlan = {
      ...downloading,
      route: 'installer',
      releaseUrl: 'https://github.com/moxxy-ai/moxxy/releases/tag/desktop-v0.6.0',
      steps: [{ id: 'installer', status: 'failed', error: 'Could not get code signature for running application' }, { id: 'restart', status: 'pending' }],
    };

    expect(model({ plan: refused })?.actions).toEqual(['retry', 'manual', 'close']);
    // Nowhere to send the person: only what can be done here is offered.
    expect(model({ plan: { ...refused, releaseUrl: undefined } })?.actions).toEqual(['retry', 'close']);
  });

  it('offers the installer by hand too when it downloaded but the restart did not bring the new version', () => {
    const notLanded: AppUpdatePlan = {
      ...downloading,
      route: 'installer',
      releaseUrl: 'https://github.com/moxxy-ai/moxxy/releases/tag/desktop-v0.6.0',
      steps: [{ id: 'installer', status: 'done' }, { id: 'restart', status: 'failed', error: 'The new version could not be put in place: EACCES' }],
    };

    expect(model({ plan: notLanded })?.actions).toEqual(['retry', 'manual', 'close']);
  });

  it('says what "Not now" does when only the installed app is left to update', () => {
    const completing: AppUpdatePlan = {
      ...downloading,
      route: 'installer',
      completes: true,
      releaseUrl: 'https://github.com/moxxy-ai/moxxy/releases/tag/desktop-v0.6.0',
      steps: [{ id: 'installer', status: 'failed', error: 'offline' }, { id: 'restart', status: 'pending' }],
    };

    expect(model({ plan: completing })).toMatchObject({
      kind: 'failed',
      subtitle: '"Not now" takes Moxxy back to the version you had.',
      actions: ['retry', 'manual', 'close'],
    });
    // Closing it is a way out, not a way to hide it: it stays until Moxxy restarts.
    expect(model({ plan: completing, closed: true })?.kind).toBe('failed');
  });

  it('lets go of a failed update once it is closed', () => {
    expect(model({ plan: failed, closed: true })).toBeNull();
  });
});

describe('updateScreenModel — the launch after', () => {
  it('finishes the update before the app opens', () => {
    expect(model({ setup: settingUp })).toMatchObject({ kind: 'setup', title: 'Finishing the update', busy: true, actions: [] });
    expect(steps({ setup: settingUp })).toEqual(['Extensions and tools:done', 'Agent runtime:running', 'Start Moxxy:pending']);
  });

  it('calls a first launch what it is', () => {
    expect(model({ setup: { ...settingUp, reason: 'install' } })?.title).toBe('Setting up Moxxy');
  });

  it('stays until the agent runtime has started', () => {
    expect(steps({ setup: setUp, runner: 'starting' })).toEqual(['Extensions and tools:done', 'Agent runtime:done', 'Start Moxxy:running']);
  });

  it('gets out of the way once Moxxy is ready', () => {
    expect(model({ setup: setUp, runner: 'ready' })).toBeNull();
  });

  it('hands over to the connection screens when the runtime does not start', () => {
    expect(model({ setup: setUp, runner: 'stopped' })).toBeNull();
  });

  it('waits behind the first-run sign-in instead of covering it', () => {
    expect(model({ setup: { ...settingUp, reason: 'install' }, onboarded: false })).toBeNull();
  });

  it('says once what a person should know, and waits for them to go on', () => {
    const noted = { ...setUp, notes: ['ChatGPT sign-in was updated. The previous copy was kept in /backup'] };

    const shown = model({ setup: noted, runner: 'ready' });

    expect(shown).toMatchObject({ kind: 'ready', title: 'Moxxy is ready', busy: false, actions: ['close'], notes: noted.notes });
    expect(model({ setup: noted, runner: 'ready', closed: true })).toBeNull();
  });

  it('shows a step that failed with its reason, and that Moxxy works anyway', () => {
    const partly: AppSetupState = {
      ...setUp,
      steps: [
        { id: 'extensions', status: 'done' },
        { id: 'components', status: 'failed', error: 'npm not found' },
      ],
    };

    const shown = model({ setup: partly, runner: 'ready' });

    expect(shown?.kind).toBe('ready');
    expect(shown?.steps[1]).toMatchObject({ label: 'Agent runtime', status: 'failed' });
    expect(shown?.steps[1]?.detail).toMatch(/npm not found.*Settings/);
  });

  it('shows the update over a setup that is still there', () => {
    expect(model({ plan: downloading, setup: setUp, runner: 'ready' })?.kind).toBe('updating');
  });
});

describe('runnerState', () => {
  it('is ready once the session is connected', () => {
    expect(runnerState({ phase: 'connected' })).toBe('ready');
  });
  it('is stopped when the connection gave up', () => {
    for (const phase of ['failed', 'cli-missing', 'protocol-incompatible']) expect(runnerState({ phase })).toBe('stopped');
  });
  it('is stopped once a start has failed and is being tried again', () => {
    expect(runnerState({ phase: 'reconnecting', attempt: 1 })).toBe('stopped');
    expect(runnerState({ phase: 'reconnecting', attempt: 0 })).toBe('starting');
  });
  it('is starting otherwise, and before anything is known', () => {
    expect(runnerState({ phase: 'spawning' })).toBe('starting');
    expect(runnerState(undefined)).toBe('starting');
  });
});
