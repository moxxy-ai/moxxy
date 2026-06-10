import { promises as fsp, type FSWatcher, watch as fsWatch } from 'node:fs';
import * as path from 'node:path';
import { createSubagentSpawner, type Session } from '@moxxy/core';
import {
  asPluginId,
  moxxyPath,
  writeFileAtomic,
  type EmittedEvent,
  type MoxxyEvent,
  type Plugin,
  type Workflow,
  type WorkflowRunResult,
  type WorkflowsView,
} from '@moxxy/sdk';
import type { ScheduleStore } from '@moxxy/plugin-scheduler';
import {
  BUILTIN_WORKFLOWS_DIR,
  WORKFLOWS_PLUGIN_NAME,
  WorkflowStore,
  buildWorkflowsPlugin,
  defaultUserWorkflowsDir,
  defaultWorkflowRunStore,
  parseWorkflowYaml,
  runWorkflow,
  serializeWorkflow,
} from '@moxxy/plugin-workflows';

/**
 * Wire the workflows plugin to the live Session. Mirrors the scheduler/webhooks
 * wiring: build a `WorkflowStore`, an autonomous runner (a subagent spawner +
 * the engine), a `WorkflowsView` for the `/workflows` modal, and the trigger
 * subsystem — schedules are mirrored into the shared scheduler poller (zero new
 * timers); `afterWorkflow` keys off the `workflow_completed` event; `fileChanged`
 * uses fs.watch. Returns the plugin entry plus a `stop()` for the watchers.
 */

interface MiniLogger {
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
  error?(msg: string, meta?: Record<string, unknown>): void;
}

export interface WorkflowsIntegration {
  readonly plugin: Plugin;
  readonly store: WorkflowStore;
  stop(): void;
}

const PLUGIN_ID = asPluginId(WORKFLOWS_PLUGIN_NAME);

/**
 * Max number of completions in one `afterWorkflow` causal chain before further
 * re-fires are refused. Mirrors the executor's nesting guard
 * (`MAX_NESTING_DEPTH` in plugin-workflows' dag executor) but for the
 * event-driven trigger graph, which would otherwise recurse without bound.
 */
export const MAX_AFTER_WORKFLOW_CHAIN = 8;

/** The trigger-relevant slice of a {@link Workflow} the cycle guards inspect. */
export type AfterWorkflowNode = Pick<Workflow, 'name' | 'enabled' | 'on'>;

export function buildWorkflowsIntegration(args: {
  session: Session;
  scheduleStore: ScheduleStore;
  logger?: MiniLogger;
}): WorkflowsIntegration {
  const { session, scheduleStore, logger } = args;
  const store = new WorkflowStore({
    cwd: session.cwd,
    builtinDir: BUILTIN_WORKFLOWS_DIR,
    ...(logger ? { logger } : {}),
  });

  const watchers: FSWatcher[] = [];
  const inFlight = new Set<string>();
  // Workflows whose afterWorkflow auto-refire is statically disabled because
  // they sit on a trigger cycle (recomputed on every syncSchedules).
  const cyclicTriggers = new Set<string>();
  const warnedCycles = new Set<string>();

  // --- the autonomous runner: spawner + engine + inbox delivery ---
  async function runNow(input: {
    name: string;
    inputs?: Record<string, unknown>;
    trigger?: string;
    /**
     * The afterWorkflow causal chain that led to this run (oldest first).
     * Carried per-run — NOT shared state — so concurrent independent fires
     * can't poison each other; it rides the `workflow_completed` payload as
     * `triggerChain` and is what lets the subscription below refuse cycles.
     */
    chain?: ReadonlyArray<string>;
  }): Promise<WorkflowRunResult> {
    const entry = await store.get(input.name);
    if (!entry) {
      return { ok: false, status: 'failed', steps: [], output: '', error: `no workflow named "${input.name}"` };
    }
    if (inFlight.has(input.name)) {
      return {
        ok: false,
        status: 'failed',
        steps: [],
        output: '',
        error: `workflow "${input.name}" is already running`,
      };
    }
    inFlight.add(input.name);
    try {
      const turnId = session.startTurn().turnId;
      const spawner = createSubagentSpawner({
        parentSession: session,
        parentTurnId: turnId,
        parentSignal: session.signal,
        parentModel: activeModel(session),
      });
      const result = await runWorkflow(
        entry.workflow,
        {
          spawner,
          tools: session.tools,
          lookup: {
            skill: (n) => session.skills.byName(n),
            workflow: (n) => store.lookup(n),
          },
          signal: session.signal,
          ...(input.inputs ? { inputs: input.inputs } : {}),
          trigger: input.trigger ?? 'auto',
          now: () => Date.now(),
          emit: (subtype, payload) =>
            void session.log.append({
              type: 'plugin_event',
              sessionId: session.id,
              turnId,
              source: 'plugin',
              pluginId: PLUGIN_ID,
              subtype,
              // Stamp the causal chain onto the completion event so the
              // afterWorkflow subscription can detect cycles/depth per-run.
              payload:
                subtype === 'workflow_completed' && input.chain && input.chain.length > 0
                  ? { ...(payload as Record<string, unknown>), triggerChain: [...input.chain] }
                  : payload,
            } as EmittedEvent),
          ...(logger ? { logger } : {}),
        },
        { executor: session.workflowExecutors.getActive() },
      );
      // A `paused` result is NOT terminal: the run is parked on an awaitInput
      // step waiting for an operator reply (resume). Delivering it to the inbox
      // would falsely present a half-done run as complete. Don't deliver, and
      // surface the paused status to the caller. (In practice awaitInput is
      // gated at validate/save time, so this is a defense-in-depth guard.)
      if (result.status === 'paused') {
        logger?.warn?.('workflows: run paused awaiting operator input; not delivering to inbox', {
          workflow: input.name,
          runId: result.runId,
        });
        return result;
      }
      await deliverToInbox(entry.workflow, result, logger);
      return result;
    } finally {
      inFlight.delete(input.name);
    }
  }

  // --- the /workflows modal view ---
  const view: WorkflowsView = {
    list: async () =>
      (await store.list()).map((w) => ({
        name: w.workflow.name,
        description: w.workflow.description,
        enabled: w.workflow.enabled,
        scope: w.scope,
        steps: w.workflow.steps.length,
        triggers: triggerSummary(w.workflow.on),
      })),
    setEnabled: async (name, enabled) => {
      await store.setEnabled(name, enabled);
      await syncSchedules();
    },
    run: async (name) => {
      const r = await runNow({ name, trigger: 'manual' });
      return {
        ok: r.ok,
        output: r.output,
        ...(r.error ? { error: r.error } : {}),
        steps: r.steps.map((s) => ({ id: s.id, status: s.status, ...(s.error ? { error: s.error } : {}) })),
      };
    },
    // Builder-facing additions (phase 2 GUI): validate a draft YAML, persist a
    // workflow, and fetch one as canonical YAML. Keep them on the same store so
    // the modal and the builder share one source of truth.
    validateDraft: async (yaml) => {
      const r = parseWorkflowYaml(yaml);
      return { ok: r.ok, errors: r.errors };
    },
    save: async (yaml, previousName) => {
      const parsed = parseWorkflowYaml(yaml);
      if (!parsed.ok || !parsed.workflow) {
        throw new Error(`invalid workflow YAML — ${parsed.errors.join('; ')}`);
      }
      const saved = await store.save(parsed.workflow, previousName);
      await syncSchedules();
      return { name: saved.workflow.name, scope: saved.scope, path: saved.path };
    },
    getRun: async (name) => {
      const entry = await store.get(name);
      if (!entry) return null;
      return {
        name: entry.workflow.name,
        scope: entry.scope,
        path: entry.path,
        yaml: serializeWorkflow(entry.workflow),
      };
    },
  };

  // --- triggers ---
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
      const sched = workflow.enabled ? workflow.on?.schedule : undefined;
      if (sched && (sched.cron || sched.runAt)) {
        const runAt = typeof sched.runAt === 'string' ? Date.parse(sched.runAt) : sched.runAt;
        await scheduleStore.syncWorkflowSchedule(workflow.name, {
          id: '',
          name: `wf-${workflow.name}`.slice(0, 120),
          // The scheduled turn runs this prompt; the model calls workflow_run,
          // whose engine drives the DAG. Scheduler writes the result to inbox.
          prompt: `Run the "${workflow.name}" workflow now using the workflow_run tool, then briefly report what each step did.`,
          ...(sched.cron ? { cron: sched.cron } : {}),
          ...(runAt ? { runAt } : {}),
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
    }
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
        run: runNow,
        ...(logger ? { logger } : {}),
      });
    })().catch((err) =>
      logger?.warn?.('workflows: afterWorkflow dispatch failed', {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  });

  async function startFileWatchers(): Promise<void> {
    for (const w of watchers.splice(0)) w.close();
    const debounced = new Map<string, NodeJS.Timeout>();
    for (const { workflow } of await store.list()) {
      if (!workflow.enabled || !workflow.on?.fileChanged) continue;
      for (const glob of [workflow.on.fileChanged].flat()) {
        const base = globBaseDir(glob, session.cwd);
        try {
          const watcher = fsWatch(base, { recursive: true }, () => {
            const prev = debounced.get(workflow.name);
            if (prev) clearTimeout(prev);
            const t = setTimeout(() => {
              void runNow({ name: workflow.name, trigger: `fileChanged:${glob}` }).catch(() => {});
            }, 600);
            t.unref?.();
            debounced.set(workflow.name, t);
          });
          watchers.push(watcher);
        } catch (err) {
          logger?.warn?.('workflows: cannot watch path', {
            workflow: workflow.name,
            base,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

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
    onChanged: syncSchedules,
    runNow,
    userDir: defaultUserWorkflowsDir(),
    onReady: async () => {
      session.workflows = view;
      await syncSchedules();
      await startFileWatchers();
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
    },
  });

  return {
    plugin: built.plugin,
    store,
    stop: () => {
      unsubscribe();
      for (const w of watchers.splice(0)) w.close();
    },
  };
}

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

function activeModel(session: Session): string {
  return safeActiveProvider(session)?.models[0]?.id ?? 'claude-sonnet-4-6';
}

function safeActiveProvider(session: Session): ReturnType<Session['providers']['getActive']> | null {
  try {
    return session.providers.getActive();
  } catch {
    return null;
  }
}

function triggerSummary(on: import('@moxxy/sdk').WorkflowTrigger | undefined): string {
  if (!on) return 'on-demand';
  const parts: string[] = [];
  if (on.schedule?.cron) parts.push(`cron(${on.schedule.cron})`);
  if (on.schedule?.runAt) parts.push('runAt');
  if (on.afterWorkflow) parts.push(`after(${[on.afterWorkflow].flat().join(',')})`);
  if (on.fileChanged) parts.push('fileChanged');
  if (on.webhook) parts.push(`webhook(${on.webhook})`);
  return parts.length > 0 ? parts.join('+') : 'on-demand';
}

/** Strip a glob down to its watchable base directory (everything before `*`). */
function globBaseDir(glob: string, cwd: string): string {
  const star = glob.indexOf('*');
  const head = star >= 0 ? glob.slice(0, star) : glob;
  const dir = head.includes('/') ? head.slice(0, head.lastIndexOf('/')) : '';
  return path.resolve(cwd, dir || '.');
}

async function deliverToInbox(
  workflow: import('@moxxy/sdk').Workflow,
  result: WorkflowRunResult,
  logger?: MiniLogger,
): Promise<void> {
  if (workflow.delivery && workflow.delivery.inbox === false) return;
  try {
    const dir = moxxyPath('inbox');
    await fsp.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${workflow.name}.md`);
    const header = [
      '---',
      `workflow: ${workflow.name}`,
      `firedAt: ${new Date().toISOString()}`,
      workflow.delivery?.channel ? `channel: ${workflow.delivery.channel}` : null,
      `outcome: ${result.ok ? 'ok' : 'error'}`,
      '---',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    const body = result.error ? `**error:** ${result.error}\n\n${result.output}` : result.output;
    await writeFileAtomic(file, header + body + '\n');
  } catch (err) {
    logger?.warn?.('workflows: inbox delivery failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
