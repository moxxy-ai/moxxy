import { describe, expect, it } from 'vitest';
import { appUpdatePlanState, type AppUpdatePlan, type AppUpdateStepId } from '@moxxy/desktop-ipc-contract';
import { runUpdatePlan, type UpdateStepActions } from './run.js';

const hotPlan: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [
    { id: 'app', status: 'pending' },
    { id: 'restart', status: 'pending' },
  ],
};

/** Records what ran and every plan that was saved, in order. */
function harness(failing: Partial<Record<AppUpdateStepId, string>> = {}) {
  const ran: AppUpdateStepId[] = [];
  const saved: AppUpdatePlan[] = [];
  const action = (id: AppUpdateStepId) => async (): Promise<void> => {
    ran.push(id);
    const reason = failing[id];
    if (reason) throw new Error(reason);
  };
  const actions: UpdateStepActions = {
    app: action('app'),
    installer: action('installer'),
    restart: action('restart'),
  };
  return { ran, saved, deps: { actions, save: async (plan: AppUpdatePlan) => void saved.push(plan) } };
}

const statuses = (plan: AppUpdatePlan) => plan.steps.map((step) => `${step.id}:${step.status}`);

describe('runUpdatePlan', () => {
  it('carries the steps out in order and leaves the restart to be confirmed by the next launch', async () => {
    const { ran, saved, deps } = harness();

    const result = await runUpdatePlan(hotPlan, deps);

    expect(ran).toEqual(['app', 'restart']);
    expect(statuses(result)).toEqual(['app:done', 'restart:running']);
    expect(appUpdatePlanState(result)).toBe('restarting');
    expect(saved.at(-1)).toEqual(result);
  });

  it('records a step as running before it starts, so a crash is visible afterwards', async () => {
    const { saved, deps } = harness();

    await runUpdatePlan(hotPlan, deps);

    expect(statuses(saved[0] as AppUpdatePlan)).toEqual(['app:running', 'restart:pending']);
  });

  it('stops at the step that fails, without restarting', async () => {
    const { ran, saved, deps } = harness({ app: 'download failed' });

    const result = await runUpdatePlan(hotPlan, deps);

    expect(ran).toEqual(['app']);
    expect(result.steps).toEqual([
      { id: 'app', status: 'failed', error: 'download failed' },
      { id: 'restart', status: 'pending' },
    ]);
    expect(appUpdatePlanState(result)).toBe('failed');
    expect(saved.at(-1)).toEqual(result);
  });

  it('does not repeat a step that is already done', async () => {
    const { ran, deps } = harness();
    const resumed: AppUpdatePlan = { ...hotPlan, steps: [{ id: 'app', status: 'done' }, { id: 'restart', status: 'pending' }] };

    const result = await runUpdatePlan(resumed, deps);

    expect(ran).toEqual(['restart']);
    expect(statuses(result)).toEqual(['app:done', 'restart:running']);
  });

  it('reports each change of the plan', async () => {
    const { deps } = harness();
    const seen: string[][] = [];

    await runUpdatePlan(hotPlan, { ...deps, onChange: (plan) => seen.push(statuses(plan)) });

    expect(seen.at(0)).toEqual(['app:running', 'restart:pending']);
    expect(seen.at(-1)).toEqual(['app:done', 'restart:running']);
  });
});
