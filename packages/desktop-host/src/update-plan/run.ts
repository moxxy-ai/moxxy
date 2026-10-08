/**
 * Carries a plan out, step by step. Every change is saved before the next
 * thing happens, so whatever stops the update — a failed step, a crash, the
 * restart itself — the plan on disk says how far it got.
 *
 * Electron-free: what each step does is the caller's.
 */

import type { AppUpdatePlan, AppUpdateStep, AppUpdateStepId } from '@moxxy/desktop-ipc-contract';

/** What each step does; a step fails by rejecting. */
export type UpdateStepActions = Readonly<Record<AppUpdateStepId, () => Promise<void>>>;

export interface RunUpdatePlanDeps {
  readonly actions: UpdateStepActions;
  readonly save: (plan: AppUpdatePlan) => Promise<void>;
  readonly onChange?: (plan: AppUpdatePlan) => void;
}

/** Returns the plan as it stands when the update stops: restarting, or failed
 *  at a step. Steps already done are not repeated. */
export async function runUpdatePlan(plan: AppUpdatePlan, deps: RunUpdatePlanDeps): Promise<AppUpdatePlan> {
  let current = plan;
  const set = async (id: AppUpdateStepId, change: Omit<AppUpdateStep, 'id'>): Promise<void> => {
    current = { ...current, steps: current.steps.map((step) => (step.id === id ? { id, ...change } : step)) };
    await deps.save(current);
    deps.onChange?.(current);
  };

  for (const { id, status } of plan.steps) {
    if (status === 'done') continue;
    await set(id, { status: 'running' });
    try {
      await deps.actions[id]();
    } catch (error) {
      await set(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
      return current;
    }
    // The restart ends this process; the next launch confirms it (settle).
    if (id !== 'restart') await set(id, { status: 'done' });
  }
  return current;
}
