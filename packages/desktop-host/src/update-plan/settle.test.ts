import { describe, expect, it } from 'vitest';
import { appUpdatePlanState, type AppUpdatePlan, type AppUpdateStep } from '@moxxy/desktop-ipc-contract';
import { settleUpdatePlan } from './settle.js';

const plan = (steps: AppUpdateStep[]): AppUpdatePlan => ({ id: 'plan-1', createdAt: 1_000, route: 'hot', version: '0.6.0', steps });
/** The bundle running and the app it is installed in, at one version. */
const both = (version: string) => ({ app: version, shell: version });
const restarting = plan([
  { id: 'app', status: 'done' },
  { id: 'restart', status: 'running' },
]);

describe('settleUpdatePlan', () => {
  it('finishes the plan when the launch after the restart runs the planned version', () => {
    expect(appUpdatePlanState(settleUpdatePlan(restarting, both('0.6.0')))).toBe('done');
  });

  it('accepts a version newer than planned', () => {
    expect(appUpdatePlanState(settleUpdatePlan(restarting, both('0.6.1')))).toBe('done');
  });

  it('fails the plan when the app came back on the old version', () => {
    expect(settleUpdatePlan(restarting, both('0.5.0')).steps.at(-1)).toEqual({
      id: 'restart',
      status: 'failed',
      error: 'Moxxy restarted on version 0.5.0, not 0.6.0.',
    });
  });

  it('fails a step the app closed in the middle of', () => {
    const interrupted = plan([{ id: 'app', status: 'running' }, { id: 'restart', status: 'pending' }]);
    expect(settleUpdatePlan(interrupted, both('0.5.0')).steps[0]).toEqual({
      id: 'app',
      status: 'failed',
      error: 'Moxxy closed before this step finished.',
    });
  });

  it('judges an installer update by the app that is installed, not by the bundle it runs', () => {
    const installing: AppUpdatePlan = { ...restarting, route: 'installer', steps: [{ id: 'installer', status: 'done' }, { id: 'restart', status: 'running' }] };

    // The new bundle on the app that was there before: the installer did not land.
    expect(settleUpdatePlan(installing, { app: '0.6.0', shell: '0.5.0' }).steps.at(-1)).toEqual({
      id: 'restart',
      status: 'failed',
      error: 'Moxxy restarted on version 0.5.0, not 0.6.0.',
    });
    expect(appUpdatePlanState(settleUpdatePlan(installing, { app: '0.5.0', shell: '0.6.0' }))).toBe('done');
  });

  it('gives the reason the installer left for not landing', () => {
    const installing: AppUpdatePlan = { ...restarting, route: 'installer' };

    expect(settleUpdatePlan(installing, both('0.5.0'), 'The new version could not be put in place: EACCES').steps.at(-1)).toEqual({
      id: 'restart',
      status: 'failed',
      error: 'The new version could not be put in place: EACCES',
    });
  });

  it('leaves a finished or failed plan as it is', () => {
    const done = settleUpdatePlan(restarting, both('0.6.0'));
    expect(settleUpdatePlan(done, both('0.1.0'))).toEqual(done);
  });
});
