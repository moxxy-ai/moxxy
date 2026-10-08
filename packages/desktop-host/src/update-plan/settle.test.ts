import { describe, expect, it } from 'vitest';
import { appUpdatePlanState, type AppUpdatePlan, type AppUpdateStep } from '@moxxy/desktop-ipc-contract';
import { settleUpdatePlan } from './settle.js';

const plan = (steps: AppUpdateStep[]): AppUpdatePlan => ({ id: 'plan-1', createdAt: 1_000, route: 'hot', version: '0.6.0', steps });
const restarting = plan([
  { id: 'app', status: 'done' },
  { id: 'restart', status: 'running' },
]);

describe('settleUpdatePlan', () => {
  it('finishes the plan when the launch after the restart runs the planned version', () => {
    expect(appUpdatePlanState(settleUpdatePlan(restarting, '0.6.0'))).toBe('done');
  });

  it('accepts a version newer than planned', () => {
    expect(appUpdatePlanState(settleUpdatePlan(restarting, '0.6.1'))).toBe('done');
  });

  it('fails the plan when the app came back on the old version', () => {
    expect(settleUpdatePlan(restarting, '0.5.0').steps.at(-1)).toEqual({
      id: 'restart',
      status: 'failed',
      error: 'Moxxy restarted on version 0.5.0, not 0.6.0.',
    });
  });

  it('fails a step the app closed in the middle of', () => {
    const interrupted = plan([{ id: 'app', status: 'running' }, { id: 'restart', status: 'pending' }]);
    expect(settleUpdatePlan(interrupted, '0.5.0').steps[0]).toEqual({
      id: 'app',
      status: 'failed',
      error: 'Moxxy closed before this step finished.',
    });
  });

  it('leaves a finished or failed plan as it is', () => {
    const done = settleUpdatePlan(restarting, '0.6.0');
    expect(settleUpdatePlan(done, '0.1.0')).toEqual(done);
  });
});
