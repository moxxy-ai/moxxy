/**
 * What one click on Update does, decided before anything is installed: the app
 * bundle when the installed shell can run it, the full installer otherwise,
 * then one restart. The runner and extensions are not part of it — the launch
 * after the restart brings them to the version the new app was built with.
 */

import type { AppUpdateCheck, AppUpdatePlan, AppUpdateStepId } from '@moxxy/desktop-ipc-contract';

export interface UpdatePlanInput {
  readonly app: AppUpdateCheck;
  readonly id: string;
  readonly now: number;
}

export function buildUpdatePlan({ app, id, now }: UpdatePlanInput): AppUpdatePlan | null {
  if (app.error || !app.available || !app.latestVersion) return null;
  const needsInstaller = app.requiresFullUpdate === true || !app.compatible;
  const steps: AppUpdateStepId[] = [needsInstaller ? 'installer' : 'app', 'restart'];
  return {
    id,
    createdAt: now,
    route: needsInstaller ? 'installer' : 'hot',
    version: app.latestVersion,
    ...(needsInstaller && app.releaseUrl ? { releaseUrl: app.releaseUrl } : {}),
    steps: steps.map((step) => ({ id: step, status: 'pending' })),
  };
}
