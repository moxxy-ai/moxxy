import { type Session } from '@moxxy/core';
import { type Plugin } from '@moxxy/sdk';
import { CrossProcessFireLock, moxxyPath } from '@moxxy/sdk/server';
import type { ScheduleStore } from '@moxxy/plugin-scheduler';
import {
  BUILTIN_WORKFLOWS_DIR,
  WorkflowStore,
  buildWorkflowsPlugin,
  defaultUserWorkflowsDir,
  defaultWorkflowRunStore,
  sweepStaleRecords,
} from '@moxxy/plugin-workflows';
import {
  activeModel,
  buildWorkflowRunner,
  safeActiveProvider,
  type MiniLogger,
} from './build-workflow-runner.js';
import { buildWorkflowsView } from './build-workflow-tools.js';
import {
  applyAfterWorkflowCycleGuard,
  detectAfterWorkflowCycles,
  fireAfterWorkflowDependents,
  MAX_AFTER_WORKFLOW_CHAIN,
  wireWorkflowTriggers,
  type AfterWorkflowNode,
} from './wire-run-store.js';

// Re-exported so existing consumers/tests keep importing these from
// `./workflows.js` unchanged after the decomposition.
export {
  activeModel,
  applyAfterWorkflowCycleGuard,
  detectAfterWorkflowCycles,
  fireAfterWorkflowDependents,
  MAX_AFTER_WORKFLOW_CHAIN,
};
export type { AfterWorkflowNode };

export interface WorkflowsIntegration {
  readonly plugin: Plugin;
  readonly store: WorkflowStore;
  stop(): void;
}

/**
 * Wire the workflows plugin to the live Session. Mirrors the scheduler/webhooks
 * wiring: build a `WorkflowStore`, an autonomous runner (a subagent spawner +
 * the engine), a `WorkflowsView` for the `/workflows` modal, and the trigger
 * subsystem — schedules are mirrored into the shared scheduler poller (zero new
 * timers); `afterWorkflow` keys off the `workflow_completed` event; `fileChanged`
 * uses fs.watch. Returns the plugin entry plus a `stop()` for the watchers.
 *
 * The body is now a thin composer over three single-concern helpers:
 * - `buildWorkflowRunner` — spawner + engine + inbox delivery (runNow/resumeNow),
 * - `wireWorkflowTriggers` — schedule/afterWorkflow/fileChanged triggers,
 * - `buildWorkflowsView` — the `/workflows` modal + builder tools.
 */
export function buildWorkflowsIntegration(args: {
  session: Session;
  scheduleStore: ScheduleStore;
  /**
   * This runner's session identity (`MOXXY_SESSION_ID`). Present only in the
   * desktop's multi-runner setup (one `moxxy serve` per workspace). When set, a
   * cross-process lock guards `fileChanged` triggers so a single edit runs the
   * workflow once across all runners instead of once per runner. A single-process
   * CLI/TUI leaves it unset and keeps the unguarded per-change behavior.
   */
  ownerSessionId?: string;
  logger?: MiniLogger;
}): WorkflowsIntegration {
  const { session, scheduleStore, ownerSessionId, logger } = args;
  const store = new WorkflowStore({
    cwd: session.cwd,
    builtinDir: BUILTIN_WORKFLOWS_DIR,
    ...(logger ? { logger } : {}),
  });

  const runner = buildWorkflowRunner({ session, store, ...(logger ? { logger } : {}) });

  // Short-TTL fire-once lock for fileChanged triggers, ONLY when this is a
  // multi-runner context (an owner id is present). The TTL bounds the window in
  // which a single shared-file edit is collapsed to one run across runners;
  // edits further apart fire again. Single-process CLI/TUI passes no lock.
  const fileLock = ownerSessionId
    ? new CrossProcessFireLock({ dir: moxxyPath('locks', 'workflow-triggers'), ttlMs: 3_000 })
    : undefined;

  const triggers = wireWorkflowTriggers({
    session,
    store,
    scheduleStore,
    runner,
    ...(fileLock ? { fireLock: fileLock } : {}),
    ...(logger ? { logger } : {}),
  });

  const view = buildWorkflowsView({ store, runner, syncSchedules: triggers.syncSchedules });

  const built = buildWorkflowsPlugin({
    store,
    skills: session.skills,
    tools: session.tools,
    getActiveExecutor: () => session.workflowExecutors.getActive(),
    appendEvent: (e) => session.log.append(e),
    ...(logger ? { logger } : {}),
    provider: () => safeActiveProvider(session),
    listSkills: () =>
      session.skills.list().map((s) => ({
        name: s.frontmatter.name,
        description: s.frontmatter.description ?? '',
      })),
    listTools: () =>
      session.tools.list().map((t) => ({ name: t.name, description: t.description ?? '' })),
    onChanged: triggers.syncSchedules,
    runNow: runner.runNow,
    userDir: defaultUserWorkflowsDir(),
    onReady: async () => {
      session.workflows = view;
      // syncSchedules also (re)builds the fileChanged fs watchers.
      await triggers.syncSchedules();
      // Sweep orphaned paused-run checkpoints on boot (a paused run whose
      // resume never arrived — e.g. before awaitInput was gated, or after a
      // crash — leaks a `<ulid>.json` under ~/.moxxy/workflow-runs/active/).
      void defaultWorkflowRunStore
        .sweepStale()
        .then((n) => {
          if (n > 0) logger?.info?.('workflows: swept stale paused-run checkpoints', { count: n });
        })
        .catch((err) =>
          logger?.warn?.('workflows: checkpoint sweep failed', {
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      // Sweep stale `*.jsonl` run records too (every runWorkflow appends one and
      // nothing else removes them — over months of scheduled runs they grow
      // without bound and slow `/workflows inspect`). Distinct dir from the
      // checkpoint sweep above (`workflow-runs/*.jsonl`, not `.../active/*.json`).
      void sweepStaleRecords()
        .then((n) => {
          if (n > 0) logger?.info?.('workflows: swept stale run records', { count: n });
        })
        .catch((err) =>
          logger?.warn?.('workflows: run-record sweep failed', {
            err: err instanceof Error ? err.message : String(err),
          }),
        );
    },
  });

  return {
    plugin: built.plugin,
    store,
    stop: triggers.stop,
  };
}
