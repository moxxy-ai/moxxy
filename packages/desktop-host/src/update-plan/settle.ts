/**
 * The launch after an update reads the plan back and settles it: a restart is
 * done only when the planned version is the one now running, and a step the
 * app closed in the middle of did not finish.
 */

import { compareSemver } from '@moxxy/sdk';
import type { AppUpdatePlan, AppUpdateStep } from '@moxxy/desktop-ipc-contract';

export function settleUpdatePlan(plan: AppUpdatePlan, runningVersion: string): AppUpdatePlan {
  const settle = (step: AppUpdateStep): AppUpdateStep => {
    if (step.status !== 'running') return step;
    if (step.id !== 'restart') return { id: step.id, status: 'failed', error: 'Moxxy closed before this step finished.' };
    return compareSemver(runningVersion, plan.version) < 0
      ? { id: step.id, status: 'failed', error: `Moxxy restarted on version ${runningVersion}, not ${plan.version}.` }
      : { id: step.id, status: 'done' };
  };
  return { ...plan, steps: plan.steps.map(settle) };
}
