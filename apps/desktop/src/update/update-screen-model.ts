/**
 * What the installer screen says, worked out from what the host reports: the
 * update being carried out before the restart, and what the launch after it
 * sets up. Pure — the screen draws the result and decides nothing.
 */

import {
  appUpdatePlanState,
  type AppSetupState,
  type AppSetupStepId,
  type AppUpdatePlan,
  type AppUpdateProgress,
  type AppUpdateStepId,
  type AppUpdateStepStatus,
} from '@moxxy/desktop-ipc-contract';

/** Whether the agent runtime of the session on screen is there yet. */
export type RunnerState = 'starting' | 'ready' | 'stopped';

export interface UpdateScreenStep {
  readonly key: string;
  readonly label: string;
  readonly status: AppUpdateStepStatus;
  /** Beside a running step: how far it is. Under a failed one: why. */
  readonly detail?: string;
}

/** `manual`: the installer downloaded and run by hand, when it could not install itself. */
export type UpdateScreenAction = 'retry' | 'manual' | 'close';

export interface UpdateScreenModel {
  readonly kind: 'updating' | 'failed' | 'setup' | 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly steps: ReadonlyArray<UpdateScreenStep>;
  /** 0..1 while a download reports its size; null when the bar can only move. */
  readonly progress: number | null;
  /** Work is going on: the mark turns and the bar shows. */
  readonly busy: boolean;
  readonly notes: ReadonlyArray<string>;
  readonly footer: string | null;
  readonly actions: ReadonlyArray<UpdateScreenAction>;
}

export interface UpdateScreenInput {
  readonly plan: AppUpdatePlan | null;
  readonly progress: AppUpdateProgress | null;
  readonly setup: AppSetupState | null;
  readonly runner: RunnerState;
  /** The first-run sign-in is behind the person. */
  readonly onboarded: boolean;
  /** The person closed what was last shown to them. */
  readonly closed: boolean;
}

const STOPPED_PHASES = new Set(['failed', 'cli-missing', 'protocol-incompatible']);

export function runnerState(phase: { readonly phase: string; readonly attempt?: number } | undefined): RunnerState {
  if (!phase) return 'starting';
  if (phase.phase === 'connected') return 'ready';
  // A start that failed and is being tried again is the connection screens'
  // to show; `attempt: 0` is the first start still under way.
  if (phase.phase === 'reconnecting' && (phase.attempt ?? 0) > 0) return 'stopped';
  return STOPPED_PHASES.has(phase.phase) ? 'stopped' : 'starting';
}

const UPDATE_STEPS: Readonly<Record<AppUpdatePlan['route'], Readonly<Record<AppUpdateStepId, string>>>> = {
  hot: { app: 'Download the update', installer: 'Download the new version', restart: 'Restart Moxxy' },
  installer: { app: 'Download the update', installer: 'Download the new version', restart: 'Install and restart' },
};

const SETUP_STEPS: Readonly<Record<AppSetupStepId, string>> = {
  extensions: 'Extensions and tools',
  components: 'Agent runtime',
  connections: 'Model connections',
};

const fraction = (progress: AppUpdateProgress | null): number | null =>
  progress?.total && progress.received != null ? Math.min(1, progress.received / progress.total) : null;

function runningDetail(progress: AppUpdateProgress | null): string | undefined {
  const done = fraction(progress);
  return done !== null ? `${Math.round(done * 100)}%` : progress?.message;
}

function updateModel(plan: AppUpdatePlan, progress: AppUpdateProgress | null, closed: boolean): UpdateScreenModel | null {
  const failed = appUpdatePlanState(plan) === 'failed';
  // With only the installed app left to update there is nothing behind the
  // screen to go back to; "Not now" restarts Moxxy on the version before.
  if (failed && closed && !plan.completes) return null;
  const steps = plan.steps.map((step): UpdateScreenStep => {
    const detail = step.status === 'failed' ? step.error : step.status === 'running' && step.id !== 'restart' ? runningDetail(progress) : undefined;
    return { key: step.id, label: UPDATE_STEPS[plan.route][step.id], status: step.status, ...(detail ? { detail } : {}) };
  });
  if (failed) {
    const byHand = plan.route === 'installer' && Boolean(plan.releaseUrl);
    return {
      kind: 'failed',
      title: 'The update could not be finished',
      subtitle: plan.completes ? '"Not now" takes Moxxy back to the version you had.' : 'Moxxy works as before.',
      steps,
      progress: null,
      busy: false,
      notes: [],
      footer: null,
      actions: byHand ? ['retry', 'manual', 'close'] : ['retry', 'close'],
    };
  }
  return {
    kind: 'updating',
    title: 'Updating Moxxy',
    subtitle: `Version ${plan.version}`,
    steps,
    progress: fraction(progress),
    busy: true,
    notes: [],
    footer: 'Nothing for you to do — Moxxy restarts by itself.',
    actions: [],
  };
}

function setupModel(setup: AppSetupState, input: UpdateScreenInput): UpdateScreenModel | null {
  if (setup.reason === null || !input.onboarded) return null;
  const { runner } = input;
  const steps = setup.steps.map((step): UpdateScreenStep => {
    const detail =
      step.status === 'failed'
        ? step.id === 'components'
          ? `${step.error ?? 'It could not be updated.'} Moxxy works with the version it has; you can try again in Settings → Update.`
          : step.error
        : step.status === 'running' && step.id === 'components'
          ? input.progress?.message
          : undefined;
    return { key: step.id, label: SETUP_STEPS[step.id], status: step.status, ...(detail ? { detail } : {}) };
  });
  const start = (status: AppUpdateStepStatus): UpdateScreenStep => ({ key: 'start', label: 'Start Moxxy', status });

  if (setup.phase !== 'done' || runner === 'starting') {
    return {
      kind: 'setup',
      title: setup.reason === 'install' ? 'Setting up Moxxy' : 'Finishing the update',
      subtitle: setup.reason === 'install' ? 'One-time setup' : 'One-time setup after the update',
      steps: [...steps, start(setup.phase === 'done' ? 'running' : 'pending')],
      progress: null,
      busy: true,
      notes: [],
      footer: 'Nothing for you to do — Moxxy opens by itself.',
      actions: [],
    };
  }
  const toSay = setup.notes.length > 0 || setup.steps.some((step) => step.status === 'failed');
  if (!toSay || input.closed) return null;
  return {
    kind: 'ready',
    title: runner === 'ready' ? 'Moxxy is ready' : 'Setup finished',
    subtitle: 'One thing to know before you go on.',
    steps: runner === 'ready' ? [...steps, start('done')] : steps,
    progress: null,
    busy: false,
    notes: setup.notes,
    footer: null,
    actions: ['close'],
  };
}

export function updateScreenModel(input: UpdateScreenInput): UpdateScreenModel | null {
  const update = input.plan ? updateModel(input.plan, input.progress, input.closed) : null;
  if (update) return update;
  return input.setup ? setupModel(input.setup, input) : null;
}
