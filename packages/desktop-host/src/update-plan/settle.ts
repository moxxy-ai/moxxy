/**
 * The launch after an update reads the plan back and settles it: a restart is
 * done only when the planned version is the one now running, and a step the
 * app closed in the middle of did not finish.
 */

import { compareSemver } from '@moxxy/sdk';
import type { AppUpdatePlan, AppUpdateStep } from '@moxxy/desktop-ipc-contract';

/** What is running: the app bundle, and the app it is installed in. */
export interface RunningVersions {
  readonly app: string;
  readonly shell: string;
}

/** `why`: the reason the installer left for not landing, when it left one. */
export function settleUpdatePlan(plan: AppUpdatePlan, running: RunningVersions, why?: string): AppUpdatePlan {
  // The installer replaces the installed app; a bundle can run ahead of it.
  const version = plan.route === 'installer' ? running.shell : running.app;
  const settle = (step: AppUpdateStep): AppUpdateStep => {
    if (step.status !== 'running') return step;
    if (step.id !== 'restart') return { id: step.id, status: 'failed', error: 'Moxxy closed before this step finished.' };
    return compareSemver(version, plan.version) < 0
      ? { id: step.id, status: 'failed', error: why ?? `Moxxy restarted on version ${version}, not ${plan.version}.` }
      : { id: step.id, status: 'done' };
  };
  return { ...plan, steps: plan.steps.map(settle) };
}
