import { type FSWatcher, watch as fsWatch } from 'node:fs';
import * as path from 'node:path';
import { type Session } from '@moxxy/core';
import type { MoxxyEvent, Workflow } from '@moxxy/sdk';
import { type ScheduleStore, isValidCron } from '@moxxy/plugin-scheduler';
import type { WorkflowStore } from '@moxxy/plugin-workflows';
import type { MiniLogger, WorkflowRunner } from './build-workflow-runner.js';

/**
 * Max number of completions in one `afterWorkflow` causal chain before further
 * re-fires are refused. Mirrors the executor's nesting guard
 * (`MAX_NESTING_DEPTH` in plugin-workflows' dag executor) but for the
 * event-driven trigger graph, which would otherwise recurse without bound.
 */
export const MAX_AFTER_WORKFLOW_CHAIN = 8;

/** The trigger-relevant slice of a {@link Workflow} the cycle guards inspect. */
export type AfterWorkflowNode = Pick<Workflow, 'name' | 'enabled' | 'on'>;

/**
 * Find cycles in the `afterWorkflow` trigger graph among enabled workflows.
 * Nodes are workflow names; an edge runs from a dependency to the workflow it
 * re-fires (completion of `dep` triggers `dependent`). Returns one entry per
 * strongly connected component that contains a cycle (size > 1, or a
 * self-loop), listing its member workflows.
 */
export function detectAfterWorkflowCycles(
  workflows: ReadonlyArray<AfterWorkflowNode>,
): string[][] {
  const enabled = new Map<string, AfterWorkflowNode>();
  for (const w of workflows) if (w.enabled) enabled.set(w.name, w);
  const edges = new Map<string, string[]>();
  for (const name of enabled.keys()) edges.set(name, []);
  for (const w of enabled.values()) {
    for (const dep of [w.on?.afterWorkflow ?? []].flat()) {
      if (enabled.has(dep)) edges.get(dep)!.push(w.name);
    }
  }

  // Tarjan's SCC. Workflow graphs are tiny; recursion depth is not a concern.
  let counter = 0;
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (v: string): void => {
    index.set(v, counter);
    lowlink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const scc: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1 || (edges.get(v) ?? []).includes(v)) cycles.push(scc.reverse());
    }
  };
  for (const name of enabled.keys()) if (!index.has(name)) visit(name);
  return cycles;
}

/**
 * Static cycle guard: rebuild `disabled` with every workflow that sits on an
 * `afterWorkflow` cycle and warn loudly once per distinct cycle. Members stay
 * runnable manually / on schedule — only the event-driven re-fire is cut.
 */
export function applyAfterWorkflowCycleGuard(args: {
  workflows: ReadonlyArray<AfterWorkflowNode>;
  /** Mutated: the set of workflow names whose auto-refire is disabled. */
  disabled: Set<string>;
  /** Mutated: cycle keys already warned about (so the warning fires once). */
  warned: Set<string>;
  logger?: MiniLogger;
}): void {
  const cycles = detectAfterWorkflowCycles(args.workflows);
  args.disabled.clear();
  for (const cycle of cycles) {
    for (const name of cycle) args.disabled.add(name);
    const key = [...cycle].sort().join(' -> ');
    if (args.warned.has(key)) continue;
    args.warned.add(key);
    args.logger?.warn?.(
      `workflows: afterWorkflow trigger cycle detected (${cycle.join(' -> ')} -> ${cycle[0]}); ` +
        'auto-refire is disabled for these workflows — run them manually or break the cycle',
      { cycle: [...cycle] },
    );
  }
}

/**
 * Fire every enabled workflow whose `on.afterWorkflow` lists `completed`,
 * unless doing so would revisit a workflow already on this run's trigger
 * chain (a cycle), exceed {@link MAX_AFTER_WORKFLOW_CHAIN}, or hit a workflow
 * the static cycle guard disabled. The chain is extended per fire and handed
 * to `run`, which must carry it onto the next completion event.
 */
export async function fireAfterWorkflowDependents(args: {
  completed: string;
  chain: ReadonlyArray<string>;
  workflows: ReadonlyArray<AfterWorkflowNode>;
  disabled: ReadonlySet<string>;
  run: (input: { name: string; trigger: string; chain: ReadonlyArray<string> }) => Promise<unknown>;
  logger?: MiniLogger;
}): Promise<void> {
  const { completed, workflows, disabled, run, logger } = args;
  const nextChain = [...args.chain, completed];
  for (const workflow of workflows) {
    if (!workflow.enabled || !workflow.on?.afterWorkflow) continue;
    if (![workflow.on.afterWorkflow].flat().includes(completed)) continue;
    if (disabled.has(workflow.name)) {
      logger?.info?.('workflows: afterWorkflow auto-refire disabled by the cycle guard; skipping', {
        workflow: workflow.name,
        after: completed,
      });
      continue;
    }
    if (nextChain.includes(workflow.name)) {
      logger?.warn?.(
        `workflows: refusing afterWorkflow re-fire — trigger cycle ` +
          `(${[...nextChain, workflow.name].join(' -> ')}); "${workflow.name}" already ran in this chain`,
        { workflow: workflow.name, chain: [...nextChain] },
      );
      continue;
    }
    if (nextChain.length >= MAX_AFTER_WORKFLOW_CHAIN) {
      logger?.warn?.(
        `workflows: refusing afterWorkflow re-fire — chain depth cap of ${MAX_AFTER_WORKFLOW_CHAIN} ` +
          `reached (${nextChain.join(' -> ')} -> ${workflow.name})`,
        { workflow: workflow.name, chain: [...nextChain] },
      );
      continue;
    }
    logger?.info?.('workflows: afterWorkflow trigger', {
      workflow: workflow.name,
      after: completed,
      depth: nextChain.length,
    });
    await run({ name: workflow.name, trigger: `after:${completed}`, chain: nextChain }).catch((err) =>
      logger?.warn?.('workflows: afterWorkflow run failed', {
        workflow: workflow.name,
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Strip a glob down to its watchable base directory (everything before `*`). */
function globBaseDir(glob: string, cwd: string): string {
  const star = glob.indexOf('*');
  const head = star >= 0 ? glob.slice(0, star) : glob;
  const dir = head.includes('/') ? head.slice(0, head.lastIndexOf('/')) : '';
  return path.resolve(cwd, dir || '.');
}

export interface WorkflowTriggerWiring {
  /** (Re)sync schedule triggers + rebuild fs watchers. Idempotent. */
  syncSchedules: () => Promise<void>;
  /** Tear down the afterWorkflow subscription + all fs watchers. */
  stop: () => void;
}

/**
 * Wire the workflow trigger subsystem against the live Session: schedule
 * triggers (mirrored into the shared scheduler poller — zero new timers),
 * `afterWorkflow` (keys off the `workflow_completed` event with per-run +
 * static cycle guards), and `fileChanged` (fs.watch). Returns `syncSchedules`
 * (call after any store mutation) and `stop` (tear-down).
 */
export function wireWorkflowTriggers(args: {
  session: Session;
  store: WorkflowStore;
  scheduleStore: ScheduleStore;
  runner: WorkflowRunner;
  logger?: MiniLogger;
}): WorkflowTriggerWiring {
  const { session, store, scheduleStore, runner, logger } = args;

  const watchers: FSWatcher[] = [];
  // Workflows whose afterWorkflow auto-refire is statically disabled because
  // they sit on a trigger cycle (recomputed on every syncSchedules).
  const cyclicTriggers = new Set<string>();
  const warnedCycles = new Set<string>();
  // Pending fileChanged debounce timers, hoisted to the wiring scope (NOT
  // re-created per startFileWatchers call). Keyed by `${workflow}::${glob}` so
  // two globs of one workflow don't clobber each other's pending timer (which
  // would mislabel the `fileChanged:<glob>` trigger). Cancelled on both rebuild
  // and stop() so a change that landed <600ms before teardown can't fire
  // runner.runNow after its watcher closed / after the subsystem stopped.
  const debounced = new Map<string, NodeJS.Timeout>();

  function cancelPendingDebounces(): void {
    for (const t of debounced.values()) clearTimeout(t);
    debounced.clear();
  }

  async function startFileWatchers(): Promise<void> {
    for (const w of watchers.splice(0)) w.close();
    cancelPendingDebounces();
    for (const { workflow } of await store.list()) {
      if (!workflow.enabled || !workflow.on?.fileChanged) continue;
      for (const glob of [workflow.on.fileChanged].flat()) {
        const base = globBaseDir(glob, session.cwd);
        const key = `${workflow.name}::${glob}`;
        const onChange = (): void => {
          const prev = debounced.get(key);
          if (prev) clearTimeout(prev);
          const t = setTimeout(() => {
            debounced.delete(key);
            void runner.runNow({ name: workflow.name, trigger: `fileChanged:${glob}` }).catch(() => {});
          }, 600);
          t.unref?.();
          debounced.set(key, t);
        };
        try {
          watchers.push(fsWatch(base, { recursive: true }, onChange));
        } catch (err) {
          // `recursive: true` is unsupported on Linux before Node 20
          // (ERR_FEATURE_UNAVAILABLE_ON_PLATFORM). Fall back to a non-recursive
          // watch on the base dir so top-level changes still fire the trigger,
          // and warn clearly that nested changes won't on this host.
          const code = (err as NodeJS.ErrnoException | undefined)?.code;
          if (code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
            try {
              watchers.push(fsWatch(base, { recursive: false }, onChange));
              logger?.warn?.(
                'workflows: recursive fileChanged watch unavailable on this platform (needs Node >=20 on Linux); ' +
                  'watching the base directory non-recursively — nested-path changes will not fire',
                { workflow: workflow.name, base, glob },
              );
              continue;
            } catch {
              // fall through to the generic warning below
            }
          }
          logger?.warn?.('workflows: cannot watch path', {
            workflow: workflow.name,
            base,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  async function syncSchedules(): Promise<void> {
    const all = await store.list();
    // Static cycle guard: warn once per cycle and disable auto-refire for its
    // members (they stay runnable manually / on schedule).
    applyAfterWorkflowCycleGuard({
      workflows: all.map((w) => w.workflow),
      disabled: cyclicTriggers,
      warned: warnedCycles,
      ...(logger ? { logger } : {}),
    });
    for (const { workflow } of all) {
      // One malformed schedule must not abort the sync of every other
      // workflow: the schema accepts `runAt` as an arbitrary string and `cron`
      // as any string, so garbage ('tomorrow', a bad cron) reaches here. Guard
      // per-workflow and skip the bad one rather than throwing out of the loop.
      try {
        const sched = workflow.enabled ? workflow.on?.schedule : undefined;
        // Normalize/validate before handing to the scheduler. A string runAt is
        // parsed to an epoch; a non-finite result (Date.parse → NaN) is dropped.
        // A cron string is rejected unless it parses, so syncWorkflowSchedule
        // never receives an entry with neither a valid cron nor a finite runAt
        // (which scheduleEntrySchema.parse would throw on, poisoning the loop).
        const parsedRunAt =
          typeof sched?.runAt === 'string' ? Date.parse(sched.runAt) : sched?.runAt;
        const runAt = typeof parsedRunAt === 'number' && Number.isFinite(parsedRunAt) ? parsedRunAt : undefined;
        const cron = sched?.cron && isValidCron(sched.cron) ? sched.cron : undefined;
        if (sched && sched.cron && !cron) {
          logger?.warn?.('workflows: ignoring invalid cron expression', {
            workflow: workflow.name,
            cron: sched.cron,
          });
        }
        if (sched && sched.runAt !== undefined && runAt === undefined) {
          logger?.warn?.('workflows: ignoring unparseable schedule.runAt', {
            workflow: workflow.name,
            runAt: sched.runAt,
          });
        }
        if (sched && (cron || runAt !== undefined)) {
          await scheduleStore.syncWorkflowSchedule(workflow.name, {
            id: '',
            name: `wf-${workflow.name}`.slice(0, 120),
            // The scheduled turn runs this prompt; the model calls workflow_run,
            // whose engine drives the DAG. Scheduler writes the result to inbox.
            prompt: `Run the "${workflow.name}" workflow now using the workflow_run tool, then briefly report what each step did.`,
            ...(cron ? { cron } : {}),
            ...(runAt !== undefined ? { runAt } : {}),
            ...(sched.timeZone ? { timeZone: sched.timeZone } : {}),
            enabled: true,
            createdAt: 0,
            source: 'workflow',
            workflowName: workflow.name,
          });
        } else {
          await scheduleStore.syncWorkflowSchedule(workflow.name, null);
        }
        // fileChanged / webhook triggers are recognized but auto-firing for them
        // is wired separately (fileChanged below; webhook is a follow-up).
        if (workflow.enabled && workflow.on?.webhook) {
          logger?.warn?.('workflows: webhook triggers are not auto-fired yet; run on demand', {
            workflow: workflow.name,
          });
        }
      } catch (err) {
        logger?.warn?.('workflows: failed to sync schedule for workflow; skipping', {
          workflow: workflow.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Rebuild fs watchers too, so a workflow whose `on.fileChanged` trigger is
    // added/enabled/edited at runtime (via view.save / view.setEnabled /
    // onChanged) starts firing without a restart — previously only onReady
    // built them, leaving schedule triggers live but fileChanged triggers
    // stale. `startFileWatchers` closes existing watchers first, so this is an
    // idempotent rebuild safe to call on every sync.
    await startFileWatchers();
  }

  // afterWorkflow: when a workflow completes, fire any enabled workflow that
  // lists it under `on.afterWorkflow`. Two cycle guards: the per-run trigger
  // chain carried on the completion payload (refuses re-fires that would
  // revisit a chain member or exceed MAX_AFTER_WORKFLOW_CHAIN), and the
  // static `cyclicTriggers` set computed by syncSchedules.
  const unsubscribe = session.log.subscribe((event: MoxxyEvent) => {
    if (event.type !== 'plugin_event' || event.subtype !== 'workflow_completed') return;
    const payload = event.payload as { name?: string; triggerChain?: unknown } | undefined;
    const completed = payload?.name;
    if (!completed) return;
    const chain = Array.isArray(payload?.triggerChain)
      ? payload.triggerChain.filter((n): n is string => typeof n === 'string')
      : [];
    void (async () => {
      await fireAfterWorkflowDependents({
        completed,
        chain,
        workflows: (await store.list()).map((w) => w.workflow),
        disabled: cyclicTriggers,
        run: runner.runNow,
        ...(logger ? { logger } : {}),
      });
    })().catch((err) =>
      logger?.warn?.('workflows: afterWorkflow dispatch failed', {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  return {
    syncSchedules,
    stop: () => {
      unsubscribe();
      for (const w of watchers.splice(0)) w.close();
      cancelPendingDebounces();
    },
  };
}
