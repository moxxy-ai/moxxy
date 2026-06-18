import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Session, silentLogger } from '@moxxy/core';
import { asPluginId, definePlugin, defineProvider, type EmittedEvent } from '@moxxy/sdk';
import { ScheduleStore } from '@moxxy/plugin-scheduler';
import { WORKFLOWS_PLUGIN_NAME } from '@moxxy/plugin-workflows';
import {
  activeModel,
  buildWorkflowsIntegration,
  applyAfterWorkflowCycleGuard,
  detectAfterWorkflowCycles,
  fireAfterWorkflowDependents,
  MAX_AFTER_WORKFLOW_CHAIN,
  type AfterWorkflowNode,
} from './workflows.js';

// ---------------------------------------------------------------------------
// helpers

function wf(
  name: string,
  opts: { after?: string | string[]; enabled?: boolean } = {},
): AfterWorkflowNode {
  return {
    name,
    enabled: opts.enabled ?? true,
    ...(opts.after ? { on: { afterWorkflow: opts.after } } : {}),
  };
}

function captureLogger(): {
  logger: { warn(msg: string): void; info(msg: string): void };
  warns: string[];
  infos: string[];
} {
  const warns: string[] = [];
  const infos: string[] = [];
  return {
    logger: {
      warn: (msg: string) => void warns.push(msg),
      info: (msg: string) => void infos.push(msg),
    },
    warns,
    infos,
  };
}

/**
 * Drive the trigger loop the way the live subscription does: each fired run
 * "completes" and feeds its (extended) chain back into the dispatcher —
 * exactly what the workflow_completed event round-trip does in production.
 */
async function simulateCompletion(args: {
  completed: string;
  chain: ReadonlyArray<string>;
  workflows: ReadonlyArray<AfterWorkflowNode>;
  disabled?: ReadonlySet<string>;
  runs: string[];
  logger?: { warn(msg: string): void; info(msg: string): void };
}): Promise<void> {
  await fireAfterWorkflowDependents({
    completed: args.completed,
    chain: args.chain,
    workflows: args.workflows,
    disabled: args.disabled ?? new Set(),
    run: async ({ name, chain }) => {
      args.runs.push(name);
      await simulateCompletion({ ...args, completed: name, chain });
    },
    ...(args.logger ? { logger: args.logger } : {}),
  });
}

// ---------------------------------------------------------------------------
// dynamic per-run chain guard

describe('fireAfterWorkflowDependents', () => {
  it('breaks an A<->B mutual trigger: each fires exactly once, then warns', async () => {
    const workflows = [wf('a', { after: 'b' }), wf('b', { after: 'a' })];
    const { logger, warns } = captureLogger();
    const runs: string[] = [];

    // "a" ran manually (empty chain) and completed.
    await simulateCompletion({ completed: 'a', chain: [], workflows, runs, logger });

    expect(runs).toEqual(['b']); // b fired once; the re-fire of a was refused
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('trigger cycle');
    expect(warns[0]).toContain('a -> b -> a');
  });

  it('breaks a three-node A->B->C->A cycle after each ran once', async () => {
    const workflows = [
      wf('a', { after: 'c' }),
      wf('b', { after: 'a' }),
      wf('c', { after: 'b' }),
    ];
    const { logger, warns } = captureLogger();
    const runs: string[] = [];

    await simulateCompletion({ completed: 'a', chain: [], workflows, runs, logger });

    expect(runs).toEqual(['b', 'c']);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('a -> b -> c -> a');
  });

  it('runs a linear A->B->C chain to completion without warnings', async () => {
    const workflows = [wf('b', { after: 'a' }), wf('c', { after: 'b' })];
    const { logger, warns } = captureLogger();
    const runs: string[] = [];

    await simulateCompletion({ completed: 'a', chain: [], workflows, runs, logger });

    expect(runs).toEqual(['b', 'c']);
    expect(warns).toEqual([]);
  });

  it('caps non-cyclic chain depth at MAX_AFTER_WORKFLOW_CHAIN', async () => {
    // w1 after w0, w2 after w1, ... — long but acyclic.
    const workflows = Array.from({ length: 20 }, (_, i) => wf(`w${i}`, { after: `w${i - 1}` })).slice(1);
    const { logger, warns } = captureLogger();
    const runs: string[] = [];

    await simulateCompletion({ completed: 'w0', chain: [], workflows, runs, logger });

    // Completion of w0 starts the chain; each fire adds one completion. The
    // cap refuses the fire that would make the chain exceed the limit.
    expect(runs).toHaveLength(MAX_AFTER_WORKFLOW_CHAIN - 1);
    expect(runs).toEqual(Array.from({ length: MAX_AFTER_WORKFLOW_CHAIN - 1 }, (_, i) => `w${i + 1}`));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(`depth cap of ${MAX_AFTER_WORKFLOW_CHAIN}`);
  });

  it('skips workflows the static cycle guard disabled (info, no run)', async () => {
    const workflows = [wf('a', { after: 'b' }), wf('b', { after: 'a' })];
    const { logger, warns, infos } = captureLogger();
    const runs: string[] = [];

    await simulateCompletion({
      completed: 'a',
      chain: [],
      workflows,
      disabled: new Set(['a', 'b']),
      runs,
      logger,
    });

    expect(runs).toEqual([]);
    expect(warns).toEqual([]);
    expect(infos.some((m) => m.includes('disabled by the cycle guard'))).toBe(true);
  });

  it('still refuses a direct self-trigger', async () => {
    const workflows = [wf('a', { after: 'a' })];
    const { logger, warns } = captureLogger();
    const runs: string[] = [];

    await simulateCompletion({ completed: 'a', chain: [], workflows, runs, logger });

    expect(runs).toEqual([]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('a -> a');
  });
});

// ---------------------------------------------------------------------------
// static graph detection

describe('detectAfterWorkflowCycles', () => {
  it('finds a mutual A<->B cycle', () => {
    const cycles = detectAfterWorkflowCycles([wf('a', { after: 'b' }), wf('b', { after: 'a' })]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]!].sort()).toEqual(['a', 'b']);
  });

  it('finds a self-loop', () => {
    expect(detectAfterWorkflowCycles([wf('a', { after: 'a' })])).toEqual([['a']]);
  });

  it('finds a longer cycle but not the acyclic tail hanging off it', () => {
    const cycles = detectAfterWorkflowCycles([
      wf('a', { after: 'c' }),
      wf('b', { after: 'a' }),
      wf('c', { after: 'b' }),
      wf('tail', { after: 'c' }),
    ]);
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]!].sort()).toEqual(['a', 'b', 'c']);
  });

  it('reports nothing for linear chains or fan-out', () => {
    expect(
      detectAfterWorkflowCycles([wf('b', { after: 'a' }), wf('c', { after: ['a', 'b'] })]),
    ).toEqual([]);
  });

  it('ignores disabled workflows — a disabled node breaks the cycle', () => {
    expect(
      detectAfterWorkflowCycles([wf('a', { after: 'b' }), wf('b', { after: 'a', enabled: false })]),
    ).toEqual([]);
  });
});

describe('applyAfterWorkflowCycleGuard', () => {
  it('disables cycle members and warns once per distinct cycle', () => {
    const { logger, warns } = captureLogger();
    const disabled = new Set<string>();
    const warned = new Set<string>();
    const workflows = [wf('a', { after: 'b' }), wf('b', { after: 'a' }), wf('c', { after: 'a' })];

    applyAfterWorkflowCycleGuard({ workflows, disabled, warned, logger });
    expect([...disabled].sort()).toEqual(['a', 'b']);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('auto-refire is disabled');

    // Re-sync: same cycle does not warn again, set is rebuilt.
    applyAfterWorkflowCycleGuard({ workflows, disabled, warned, logger });
    expect(warns).toHaveLength(1);
    expect([...disabled].sort()).toEqual(['a', 'b']);

    // Breaking the cycle re-enables the members.
    applyAfterWorkflowCycleGuard({
      workflows: [wf('a'), wf('b', { after: 'a' }), wf('c', { after: 'a' })],
      disabled,
      warned,
      logger,
    });
    expect(disabled.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// end-to-end through the live wiring: real Session + event log + runNow, with
// a stub executor so no subagents/providers are involved. Verifies the chain
// actually rides the workflow_completed payload across the event round-trip.

describe('buildWorkflowsIntegration afterWorkflow wiring', () => {
  const tempDirs: string[] = [];
  const savedEnv = { HOME: process.env.HOME, MOXXY_HOME: process.env.MOXXY_HOME };

  afterAll(async () => {
    process.env.HOME = savedEnv.HOME;
    process.env.MOXXY_HOME = savedEnv.MOXXY_HOME;
    await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function setup(workflowYamls: Record<string, string>): Promise<{
    session: Session;
    runs: string[];
    stop: () => void;
  }> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-workflows-it-'));
    tempDirs.push(cwd);
    // Isolate every homedir-derived path (user workflows dir, inbox, run records).
    process.env.HOME = cwd;
    process.env.MOXXY_HOME = path.join(cwd, '.moxxy-home');

    const projectDir = path.join(cwd, '.moxxy', 'workflows');
    await fs.mkdir(projectDir, { recursive: true });
    for (const [file, yaml] of Object.entries(workflowYamls)) {
      await fs.writeFile(path.join(projectDir, file), yaml);
    }

    const session = new Session({ cwd, logger: silentLogger });
    const runs: string[] = [];
    session.workflowExecutors.register({
      name: 'stub',
      run: async (workflow, deps) => {
        runs.push(workflow.name);
        await deps.emit?.('workflow_completed', { name: workflow.name, output: '' });
        return { ok: true, steps: [], output: '' };
      },
    });
    const integration = buildWorkflowsIntegration({
      session,
      scheduleStore: new ScheduleStore({ file: path.join(cwd, 'schedules.json') }),
    });
    return { session, runs, stop: integration.stop };
  }

  function completedEvent(session: Session, name: string): EmittedEvent {
    return {
      type: 'plugin_event',
      sessionId: session.id,
      turnId: session.startTurn().turnId,
      source: 'plugin',
      pluginId: asPluginId(WORKFLOWS_PLUGIN_NAME),
      subtype: 'workflow_completed',
      payload: { name },
    } as EmittedEvent;
  }

  const yaml = (name: string, after: string): string =>
    [
      `name: ${name}`,
      'description: test workflow',
      'on:',
      `  afterWorkflow: ${after}`,
      'delivery:',
      '  inbox: false',
      'steps:',
      '  - id: s1',
      '    prompt: hi',
      '',
    ].join('\n');

  it('A<->B mutual trigger fires each dependent exactly once, then stops', async () => {
    const { session, runs, stop } = await setup({
      'wf-a.yaml': yaml('wf-a', 'wf-b'),
      'wf-b.yaml': yaml('wf-b', 'wf-a'),
    });
    try {
      await session.log.append(completedEvent(session, 'wf-a'));
      await vi.waitFor(() => expect(runs).toContain('wf-b'));
      // Let any (buggy) follow-on fires land before asserting quiescence.
      await new Promise((r) => setTimeout(r, 100));
      expect(runs).toEqual(['wf-b']);
    } finally {
      stop();
    }
  });

  it('linear A->B->C chain runs each workflow once', async () => {
    const { session, runs, stop } = await setup({
      'wf-b.yaml': yaml('wf-b', 'wf-a'),
      'wf-c.yaml': yaml('wf-c', 'wf-b'),
    });
    try {
      await session.log.append(completedEvent(session, 'wf-a'));
      await vi.waitFor(() => expect(runs).toContain('wf-c'));
      await new Promise((r) => setTimeout(r, 100));
      expect(runs).toEqual(['wf-b', 'wf-c']);
    } finally {
      stop();
    }
  });

  it('does NOT deliver a paused (awaitInput) run to the inbox (Finding 1)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-workflows-pause-'));
    tempDirs.push(cwd);
    process.env.HOME = cwd;
    process.env.MOXXY_HOME = path.join(cwd, '.moxxy-home');

    const projectDir = path.join(cwd, '.moxxy', 'workflows');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, 'paused-wf.yaml'),
      ['name: paused-wf', 'description: test', 'steps:', '  - id: s1', '    prompt: hi', ''].join('\n'),
    );

    const session = new Session({ cwd, logger: silentLogger });
    // A stub executor that returns a non-terminal `paused` result, mimicking a
    // run parked on an awaitInput step awaiting resume.
    session.workflowExecutors.register({
      name: 'paused-stub',
      run: async () => ({
        ok: true,
        status: 'paused',
        steps: [],
        output: 'question for the operator',
        runId: 'RUN1',
        pendingStepId: 's1',
      }),
    });
    const integration = buildWorkflowsIntegration({ session, scheduleStore: new ScheduleStore({ file: path.join(cwd, 'sched.json') }) });
    // onReady (which assigns session.workflows = view) fires on plugin onInit.
    session.pluginHost.registerStatic(integration.plugin);
    await session.dispatcher.dispatchInit(session.appContext());
    try {
      const result = await session.workflows!.run('paused-wf');
      // The view maps the run result; a paused run must not look "ok+complete"
      // with an inbox file behind it.
      const inboxDir = path.join(process.env.MOXXY_HOME!, 'inbox');
      let inboxFiles: string[] = [];
      try {
        inboxFiles = await fs.readdir(inboxDir);
      } catch {
        inboxFiles = [];
      }
      expect(inboxFiles).toEqual([]);
      // The output still surfaces, but no inbox delivery happened.
      expect(result.output).toContain('question for the operator');
      // The paused run is non-terminal: the view surfaces its status + runId so
      // the operator UI can offer a reply box, and `resume` is wired.
      expect(result.status).toBe('paused');
      expect(result.runId).toBe('RUN1');
      expect(typeof session.workflows!.resume).toBe('function');
      // Resuming a run with no checkpoint on disk fails cleanly (rather than
      // hanging) — proves the resume path reaches resumeWorkflowRun.
      const resumed = await session.workflows!.resume!('UNKNOWN', 'reply');
      expect(resumed.ok).toBe(false);
      expect(resumed.error ?? '').toMatch(/no paused workflow run/);
    } finally {
      integration.stop();
    }
  });

  it('registers fileChanged watchers for a workflow saved at RUNTIME (u28-1)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-workflows-fc-'));
    tempDirs.push(cwd);
    process.env.HOME = cwd;
    process.env.MOXXY_HOME = path.join(cwd, '.moxxy-home');

    // Boot with NO fileChanged workflow on disk — so onReady builds zero
    // fs watchers. The fix must (re)build them when one is saved at runtime.
    const projectDir = path.join(cwd, '.moxxy', 'workflows');
    await fs.mkdir(projectDir, { recursive: true });

    const session = new Session({ cwd, logger: silentLogger });
    const runs: string[] = [];
    session.workflowExecutors.register({
      name: 'stub',
      run: async (workflow) => {
        runs.push(workflow.name);
        return { ok: true, steps: [], output: '' };
      },
    });
    const integration = buildWorkflowsIntegration({
      session,
      scheduleStore: new ScheduleStore({ file: path.join(cwd, 'sched.json') }),
    });
    session.pluginHost.registerStatic(integration.plugin);
    await session.dispatcher.dispatchInit(session.appContext());
    try {
      // A directory the workflow watches.
      const watchedDir = path.join(cwd, 'watched');
      await fs.mkdir(watchedDir, { recursive: true });

      // Save a fileChanged workflow at runtime (the path onReady never saw).
      await session.workflows!.save(
        [
          'name: on-touch',
          'description: fires on file change',
          'on:',
          `  fileChanged: ${path.join(watchedDir, '**', '*.txt').replace(/\\/g, '/')}`,
          'delivery:',
          '  inbox: false',
          'steps:',
          '  - id: s1',
          '    prompt: hi',
          '',
        ].join('\n'),
      );

      // Touch a matching file; the watcher (debounced 600ms) should fire runNow.
      await fs.writeFile(path.join(watchedDir, 'note.txt'), 'hello');

      await vi.waitFor(() => expect(runs).toContain('on-touch'), { timeout: 4000, interval: 50 });
    } finally {
      integration.stop();
    }
  });

  it('delivers a resumed run to the inbox once it completes (Finding 1, resume side)', async () => {
    // The resume side of the human-in-the-loop loop: a checkpoint that completes
    // on resume IS terminal, so it must land in the inbox (unlike the paused
    // result, which is withheld). We drive resumeNow via session.workflows.resume
    // and assert the inbox delivery happens. The retained child is faked by a
    // checkpoint whose pending step is a prompt and a spawner.continue stub.
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-workflows-resume-'));
    tempDirs.push(cwd);
    process.env.HOME = cwd;
    process.env.MOXXY_HOME = path.join(cwd, '.moxxy-home');

    const { WorkflowRunStore, resumeWorkflowRun } = await import('@moxxy/plugin-workflows');
    const store = new WorkflowRunStore(path.join(process.env.MOXXY_HOME, 'workflow-runs', 'active'));
    const runId = await store.save({
      workflow: {
        name: 'resume-wf',
        description: 'x',
        version: 1,
        enabled: true,
        inputs: {},
        concurrency: 4,
        steps: [{ id: 'ask', prompt: 'q', awaitInput: true, needs: [], onError: 'fail', retries: 0 }],
      } as never,
      trigger: 'manual',
      inputs: {},
      states: { ask: { status: 'awaiting_input', output: 'q', startedAt: 1, endedAt: 1 } },
      vars: {},
      pendingStepId: 'ask',
      interactionAgentId: 'child-1',
      startedAt: 1,
    });

    // A spawner whose continue() resolves the reply (no real retained child).
    const spawner = {
      spawn: async () => ({ label: 'x', childSessionId: 'c' as never, text: '', stopReason: 'end_turn' as const }),
      spawnAll: async () => [],
      continue: async (args: { childSessionId: never; prompt: string; label?: string }) => ({
        label: args.label ?? 'ask',
        childSessionId: args.childSessionId,
        text: 'FINAL',
        stopReason: 'end_turn' as const,
      }),
      release: () => {},
    };
    const result = await resumeWorkflowRun(
      runId,
      'go',
      {
        spawner: spawner as never,
        tools: { get: () => ({}), execute: async () => '' },
        lookup: { skill: () => undefined, workflow: () => undefined },
        signal: new AbortController().signal,
        now: () => Date.now(),
      },
      store,
    );
    expect(result.status).toBe('completed');
    expect(result.ok).toBe(true);
    // The checkpoint is cleaned up once resumed.
    expect(await store.load(runId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// activeModel — model resolution for trigger-spawned workflow children

describe('activeModel', () => {
  function sessionWithProvider(modelIds: ReadonlyArray<string>): Session {
    const session = new Session({ cwd: '/tmp', logger: silentLogger });
    const models = modelIds.map((id) => ({ id }));
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'test-workflow-provider',
        providers: [
          defineProvider({
            name: 'wf-test',
            models,
            createClient: () => ({
              name: 'wf-test',
              models,
              stream: async function* () {
                // unused
              },
              countTokens: async () => 0,
            }),
          }),
        ],
      }),
    );
    session.providers.setActive('wf-test');
    return session;
  }

  it('prefers the model the last turn actually resolved (lastResolvedModel)', () => {
    const session = sessionWithProvider(['descriptor-first', 'other']);
    session.lastResolvedModel = 'user-picked-model';
    expect(activeModel(session)).toBe('user-picked-model');
  });

  it('falls back to the active provider first descriptor before any turn ran', () => {
    const session = sessionWithProvider(['descriptor-first', 'other']);
    expect(activeModel(session)).toBe('descriptor-first');
  });

  it("returns 'default' (runTurn's own terminal fallback) with no provider and no turn", () => {
    const session = new Session({ cwd: '/tmp', logger: silentLogger });
    expect(activeModel(session)).toBe('default');
  });
});
