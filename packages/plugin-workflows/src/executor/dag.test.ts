import {
  asSessionId,
  type Skill,
  type SubagentResult,
  type SubagentSpec,
  type SubagentSpawner,
  type Workflow,
  type WorkflowRunDeps,
} from '@moxxy/sdk';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '../schema.js';
import { WorkflowRunStore } from '../run-store.js';
import { dagExecutor, resumeWorkflowRun } from './dag.js';

function wf(obj: Record<string, unknown>): Workflow {
  const r = validateWorkflow(obj);
  if (!r.ok || !r.workflow) throw new Error(`invalid test workflow: ${r.errors.join('; ')}`);
  return r.workflow;
}

/**
 * Build a Workflow shape WITHOUT schema validation — a convenience for tests
 * that need to construct edge-case step combinations the author-time schema
 * rejects (e.g. an awaitInput step that the schema only permits on prompt/skill
 * actions). The human-in-the-loop happy path is exercised through the real
 * `wf()` (schema-validated) helper above; `rawWf` is for the negative/edge cases.
 */
function rawWf(steps: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}): Workflow {
  return {
    name: 'raw',
    description: 'x',
    version: 1,
    enabled: true,
    inputs: {},
    concurrency: 4,
    steps: steps.map((s) => ({
      needs: [],
      onError: 'fail',
      retries: 0,
      ...s,
    })),
    ...extra,
  } as unknown as Workflow;
}

interface Harness {
  readonly deps: WorkflowRunDeps;
  readonly specs: SubagentSpec[];
  readonly order: string[];
  readonly toolCalls: Array<{ name: string; input: unknown }>;
}

/**
 * Logic/loop LLM calls are scripted by label. A function value lets a test
 * vary the reply by call count (e.g. continue twice, then stop).
 */
type LogicScript = Record<string, string | ((callIndex: number) => string)>;

function makeHarness(overrides: Partial<WorkflowRunDeps> = {}, skills: Record<string, string> = {}): Harness {
  const specs: SubagentSpec[] = [];
  const order: string[] = [];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let clock = 1;

  const logicResponses: LogicScript = (overrides as { logicResponses?: LogicScript }).logicResponses ?? {};
  const callCounts = new Map<string, number>();

  const spawn = async (spec: SubagentSpec): Promise<SubagentResult> => {
    specs.push(spec);
    const label = spec.label ?? '?';
    order.push(label);
    const isLogic = spec.systemPrompt?.includes('workflow logic step');
    let text: string;
    if (isLogic) {
      const scripted = logicResponses[label];
      const n = callCounts.get(label) ?? 0;
      callCounts.set(label, n + 1);
      text = typeof scripted === 'function' ? scripted(n) : (scripted ?? `{"text":"OUT_${label}"}`);
    } else {
      text = `OUT_${label}`;
    }
    return {
      label,
      childSessionId: asSessionId('child'),
      text,
      stopReason: 'end_turn',
    };
  };
  const spawner: SubagentSpawner = {
    spawn,
    spawnAll: (list) => Promise.all(list.map(spawn)),
    continue: async (args) => {
      specs.push({ prompt: args.prompt, label: args.label ?? '?' });
      order.push(`continue:${args.label ?? '?'}`);
      return {
        label: args.label ?? '?',
        childSessionId: args.childSessionId,
        text: `FINAL_${args.label ?? '?'}`,
        stopReason: 'end_turn',
      };
    },
    release: () => {},
  };

  const fakeSkill = (name: string, body: string): Skill => ({
    id: `user/${name}` as never,
    path: `/tmp/${name}.md`,
    scope: 'user',
    frontmatter: { name, description: 'test skill', 'allowed-tools': ['Read'] },
    body,
  });

  const deps: WorkflowRunDeps = {
    spawner,
    tools: {
      get: () => ({}),
      execute: async (name, input) => {
        toolCalls.push({ name, input });
        order.push(`tool:${name}`);
        return `TOOL_${name}`;
      },
    },
    lookup: {
      skill: (n) => (skills[n] !== undefined ? fakeSkill(n, skills[n]!) : undefined),
      workflow: () => undefined,
    },
    signal: new AbortController().signal,
    now: () => clock++,
    ...overrides,
  };
  return { deps, specs, order, toolCalls };
}

describe('dag executor', () => {
  it('runs a linear chain and pipes output→input', async () => {
    const h = makeHarness();
    const result = await dagExecutor.run(
      wf({
        name: 'lin',
        description: 'x',
        steps: [
          { id: 'fetch', prompt: 'go' },
          { id: 'analyze', needs: ['fetch'], prompt: 'see {{ steps.fetch.output }}' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.status)).toEqual(['completed', 'completed']);
    const analyze = h.specs.find((s) => s.label === 'analyze')!;
    expect(analyze.prompt).toBe('see OUT_fetch');
    expect(result.output).toBe('OUT_analyze'); // sink
  });

  it('fans out in parallel and fans back in', async () => {
    const h = makeHarness();
    const result = await dagExecutor.run(
      wf({
        name: 'fan',
        description: 'x',
        steps: [
          { id: 'fetch', prompt: 'go' },
          { id: 'analyze', needs: ['fetch'], prompt: 'a {{ steps.fetch.output }}' },
          { id: 'check', needs: ['fetch'], prompt: 'c {{ steps.fetch.output }}' },
          {
            id: 'email',
            needs: ['analyze', 'check'],
            tool: 'send',
            args: { body: '{{ steps.analyze.output }}|{{ steps.check.output }}' },
          },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(h.order.indexOf('fetch')).toBeLessThan(h.order.indexOf('analyze'));
    expect(h.order.indexOf('fetch')).toBeLessThan(h.order.indexOf('check'));
    expect(h.order.indexOf('analyze')).toBeLessThan(h.order.indexOf('tool:send'));
    expect(h.order.indexOf('check')).toBeLessThan(h.order.indexOf('tool:send'));
    expect(h.toolCalls[0]!.input).toEqual({ body: 'OUT_analyze|OUT_check' });
  });

  it('skips a step whose `when` is false but still runs its dependents', async () => {
    const h = makeHarness();
    const result = await dagExecutor.run(
      wf({
        name: 'when',
        description: 'x',
        steps: [
          { id: 'a', prompt: 'go' },
          { id: 'b', needs: ['a'], when: '{{ steps.a.output }} contains "ZZZ"', prompt: 'b' },
          { id: 'c', needs: ['b'], prompt: 'c' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId).toEqual({ a: 'completed', b: 'skipped', c: 'completed' });
  });

  it('uses a skill body as the child system prompt + allowed tools', async () => {
    const h = makeHarness({}, { 'web-research': 'RESEARCH PLAYBOOK' });
    await dagExecutor.run(
      wf({
        name: 'sk',
        description: 'x',
        steps: [{ id: 's', skill: 'web-research', input: 'find news' }],
      }),
      h.deps,
    );
    const spec = h.specs[0]!;
    expect(spec.systemPrompt).toBe('RESEARCH PLAYBOOK');
    expect(spec.prompt).toBe('find news');
    expect(spec.allowedTools).toEqual(['Read']);
  });

  it('aborts the workflow when a step fails with onError=fail', async () => {
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          throw new Error('boom');
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'fail',
        description: 'x',
        steps: [
          { id: 'a', tool: 'x', onError: 'fail' },
          { id: 'b', needs: ['a'], prompt: 'b' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.a).toBe('failed');
    expect(byId.b).toBe('skipped'); // never ran
  });

  it('continues past a failed step when onError=continue', async () => {
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          throw new Error('boom');
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'cont',
        description: 'x',
        steps: [
          { id: 'a', tool: 'x', onError: 'continue' },
          { id: 'b', needs: ['a'], prompt: 'b' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true); // tolerated
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.a).toBe('failed');
    expect(byId.b).toBe('completed');
  });

  it('retries a flaky step up to `retries` times', async () => {
    let attempts = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          attempts += 1;
          if (attempts < 2) throw new Error('transient');
          return 'recovered';
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'retry',
        description: 'x',
        steps: [{ id: 'a', tool: 'x', onError: 'retry', retries: 2 }],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
    expect(result.steps[0]!.status).toBe('completed');
  });

  // Retry contract (u117-3): `retries` is gated on `onError: 'retry'`. The three
  // modes below pin the exact attempt count so 'retry' is behaviorally distinct
  // from 'fail' and an author can't accidentally retry by setting retries on a
  // non-retry mode.
  it('onError=retry runs 1 + retries attempts when the step keeps failing', async () => {
    let attempts = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          attempts += 1;
          throw new Error('always');
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'retry-exhaust',
        description: 'x',
        steps: [{ id: 'a', tool: 'x', onError: 'retry', retries: 2 }],
      }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(3); // 1 initial + 2 retries
    expect(result.steps[0]!.status).toBe('failed');
  });

  it('onError=fail runs exactly ONE attempt even with retries set', async () => {
    let attempts = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          attempts += 1;
          throw new Error('boom');
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'fail-no-retry',
        description: 'x',
        steps: [{ id: 'a', tool: 'x', onError: 'fail', retries: 2 }],
      }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1); // retries ignored outside retry mode
    expect(result.steps[0]!.status).toBe('failed');
  });

  it('onError=continue runs exactly ONE attempt even with retries set', async () => {
    let attempts = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          attempts += 1;
          throw new Error('boom');
        },
      },
    });
    const result = await dagExecutor.run(
      wf({
        name: 'continue-no-retry',
        description: 'x',
        steps: [
          { id: 'a', tool: 'x', onError: 'continue', retries: 3 },
          { id: 'b', needs: ['a'], prompt: 'b' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true); // tolerated
    expect(attempts).toBe(1); // retries ignored outside retry mode
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.a).toBe('failed');
    expect(byId.b).toBe('completed');
  });

  it('runs a nested workflow and captures its output', async () => {
    const inner = wf({ name: 'inner', description: 'x', steps: [{ id: 'i', prompt: 'hi' }] });
    const h = makeHarness();
    const deps: WorkflowRunDeps = {
      ...h.deps,
      lookup: { skill: () => undefined, workflow: (n) => (n === 'inner' ? inner : undefined) },
    };
    const result = await dagExecutor.run(
      wf({ name: 'outer', description: 'x', steps: [{ id: 'o', workflow: 'inner' }] }),
      deps,
    );
    expect(result.ok).toBe(true);
    expect(result.steps[0]!.output).toBe('OUT_i');
  });

  it('a hard failure breaks the rest of the wave (no later step runs or completes)', async () => {
    const events: Array<{ subtype: string; id?: string }> = [];
    const h = makeHarness({
      emit: (subtype, payload) =>
        void events.push({ subtype, id: (payload as { id?: string })?.id }),
      tools: {
        get: () => ({}),
        execute: async () => {
          throw new Error('boom');
        },
      },
    });
    // `a` (tool, fails onError=fail) and `b` (prompt) are INDEPENDENT, so both
    // land in the same wave. `a` failing must stop `b` from running.
    const result = await dagExecutor.run(
      wf({
        name: 'wave-abort',
        description: 'x',
        steps: [
          { id: 'a', tool: 'x', onError: 'fail' },
          { id: 'b', prompt: 'b' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.a).toBe('failed');
    expect(byId.b).toBe('skipped'); // never ran
    // `b` produced neither a started nor a completed event and never spawned.
    expect(events.some((e) => e.subtype === 'workflow_step_started' && e.id === 'b')).toBe(false);
    expect(events.some((e) => e.subtype === 'workflow_step_completed' && e.id === 'b')).toBe(false);
    expect(h.order).not.toContain('b');
  });

  it('rejects awaitInput inside a nested workflow and leaves no orphaned checkpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-nested-pause-'));
    const store = new WorkflowRunStore(dir);
    // Inner workflow pauses on an awaitInput prompt step.
    const inner = wf({
      name: 'inner',
      description: 'x',
      steps: [{ id: 'ask', prompt: 'Ask the operator', awaitInput: true }],
    });
    const h = makeHarness({ runStore: store } as Partial<WorkflowRunDeps>);
    const deps: WorkflowRunDeps = {
      ...h.deps,
      lookup: { skill: () => undefined, workflow: (n) => (n === 'inner' ? inner : undefined) },
    };
    const result = await dagExecutor.run(
      wf({ name: 'outer', description: 'x', steps: [{ id: 'o', workflow: 'inner' }] }),
      deps,
    );
    // The run fails loudly (does NOT report paused/completed) and names awaitInput.
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.steps[0]!.status).toBe('failed');
    expect(result.steps[0]!.error).toMatch(/awaitInput/i);
    // No orphaned inner checkpoint left behind in the store.
    const leftover = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(leftover).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('emits lifecycle events', async () => {
    const events: string[] = [];
    const h = makeHarness({ emit: (subtype) => void events.push(subtype) });
    await dagExecutor.run(
      wf({ name: 'ev', description: 'x', steps: [{ id: 'a', prompt: 'go' }] }),
      h.deps,
    );
    expect(events).toContain('workflow_started');
    expect(events).toContain('workflow_step_started');
    expect(events).toContain('workflow_step_completed');
    expect(events).toContain('workflow_completed');
  });

  it('pauses on awaitInput and resumes after operator reply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-pause-'));
    const store = new WorkflowRunStore(dir);
    const events: string[] = [];
    const h = makeHarness({
      emit: (subtype) => void events.push(subtype),
      runStore: store,
    } as Partial<WorkflowRunDeps>);
    const paused = await dagExecutor.run(
      rawWf([
        { id: 'ask', prompt: 'Ask for brief', awaitInput: true },
        { id: 'go', needs: ['ask'], prompt: 'Use {{ steps.ask.output }}' },
      ]),
      h.deps,
    );
    expect(paused.status).toBe('paused');
    expect(paused.runId).toBeTruthy();
    expect(paused.interactionAgentId).toBeTruthy();
    expect(events).toContain('workflow_step_awaiting_input');
    expect(events).toContain('workflow_paused');

    const resumed = await resumeWorkflowRun(paused.runId!, 'cyberpunk city at night', h.deps, store);
    expect(resumed.status).toBe('completed');
    expect(resumed.ok).toBe(true);
    const go = h.specs.find((s) => s.label === 'go')!;
    expect(go.prompt).toContain('FINAL_ask');
    await rm(dir, { recursive: true, force: true });
  });

  it('resume does not re-emit workflow_started (single start across the lifecycle)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-resume-start-'));
    const store = new WorkflowRunStore(dir);
    const events: string[] = [];
    const h = makeHarness({
      emit: (subtype) => void events.push(subtype),
      runStore: store,
    } as Partial<WorkflowRunDeps>);
    const paused = await dagExecutor.run(
      rawWf([
        { id: 'ask', prompt: 'Ask for brief', awaitInput: true },
        { id: 'go', needs: ['ask'], prompt: 'Use {{ steps.ask.output }}' },
      ]),
      h.deps,
    );
    expect(paused.status).toBe('paused');
    // Same emit spy drives the resume — assert ONE workflow_started total.
    await resumeWorkflowRun(paused.runId!, 'reply', h.deps, store);
    expect(events.filter((e) => e === 'workflow_started')).toHaveLength(1);
    // workflow_resumed precedes any continued step-completed event.
    const resumedAt = events.indexOf('workflow_resumed');
    const goCompletedAt = events.lastIndexOf('workflow_step_completed');
    expect(resumedAt).toBeGreaterThanOrEqual(0);
    expect(resumedAt).toBeLessThan(goCompletedAt);
    await rm(dir, { recursive: true, force: true });
  });

  it('end-to-end human-in-the-loop: schema-validated workflow PAUSES, then resumes to COMPLETE with the reply + vars available', async () => {
    // This is the un-gate proof: a workflow authored with `awaitInput: true` is
    // now ACCEPTED by validateWorkflow (no gate), pauses with a workflow_paused
    // event carrying the prompt + runId, and resumeWorkflowRun() drives it to
    // `completed` (NOT paused/hung). The operator reply is available downstream,
    // and a var set BEFORE the pause survives the checkpoint round-trip.
    const dir = await mkdtemp(join(tmpdir(), 'wf-hitl-'));
    const store = new WorkflowRunStore(dir);
    const events: Array<{ subtype: string; payload: unknown }> = [];
    const h = makeHarness({
      emit: (subtype, payload) => void events.push({ subtype, payload }),
      runStore: store,
      logicResponses: { extract: '{"vars":{"channel":"#ops"}}' },
    } as Partial<WorkflowRunDeps>);
    // Authored exactly as an operator would: validated through the real schema.
    const workflow = wf({
      name: 'hitl-approve',
      description: 'Set a var, pause to ask the operator, then act on the reply.',
      steps: [
        { id: 'extract', bridge: 'set vars.channel' },
        { id: 'ask', needs: ['extract'], label: 'Approve', prompt: 'Ship to {{ vars.channel }}?', awaitInput: true },
        { id: 'publish', needs: ['ask'], tool: 'notify', args: { to: '{{ vars.channel }}', body: '{{ steps.ask.output }}' } },
      ],
    });

    const paused = await dagExecutor.run(workflow, h.deps);
    // PAUSED — checkpoint written, workflow_paused emitted with the prompt step + runId.
    expect(paused.status).toBe('paused');
    expect(paused.runId).toBeTruthy();
    const pausedEvent = events.find((e) => e.subtype === 'workflow_paused');
    expect(pausedEvent?.payload).toMatchObject({ runId: paused.runId, stepId: 'ask' });
    // The pending step's prompt is surfaced to the operator (awaiting_input preview).
    const awaiting = events.find((e) => e.subtype === 'workflow_step_awaiting_input');
    expect(awaiting?.payload).toMatchObject({ id: 'ask' });
    expect(await store.load(paused.runId!)).not.toBeNull();

    // RESUME with the operator reply → run COMPLETES (not paused/hung).
    const resumed = await resumeWorkflowRun(paused.runId!, 'ship it', h.deps, store);
    expect(resumed.status).toBe('completed');
    expect(resumed.ok).toBe(true);
    // The downstream tool ran with the reply AND the pre-pause var.
    expect(h.toolCalls.find((c) => c.name === 'notify')?.input).toEqual({ to: '#ops', body: 'FINAL_Approve' });
    // The checkpoint is cleaned up once resumed (no orphaned paused run).
    expect(await store.load(paused.runId!)).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it('restores vars set before the pause on resume (Finding 4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-pause-vars-'));
    const store = new WorkflowRunStore(dir);
    const h = makeHarness({
      runStore: store,
      logicResponses: { extract: '{"vars":{"email":"ops@example.com"}}' },
    } as Partial<WorkflowRunDeps>);
    // A bridge runs BEFORE the awaitInput pause, setting vars.email. After
    // resume, a downstream tool reads {{ vars.email }}; without persisting vars
    // in the checkpoint it would render empty.
    const paused = await dagExecutor.run(
      rawWf([
        { id: 'extract', bridge: 'extract email into vars.email' },
        { id: 'ask', needs: ['extract'], prompt: 'Ask for brief', awaitInput: true },
        {
          id: 'send',
          needs: ['ask'],
          tool: 'notify',
          args: { to: '{{ vars.email }}' },
        },
      ]),
      h.deps,
    );
    expect(paused.status).toBe('paused');

    const resumed = await resumeWorkflowRun(paused.runId!, 'go ahead', h.deps, store);
    expect(resumed.ok).toBe(true);
    expect(h.toolCalls.find((c) => c.name === 'notify')?.input).toEqual({ to: 'ops@example.com' });
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a concurrent resume of the same runId (no double-continue / double-remove)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-resume-race-'));
    const store = new WorkflowRunStore(dir);
    let continueCalls = 0;
    let removeCalls = 0;
    const spawnOne = async (spec: SubagentSpec): Promise<SubagentResult> => ({
      label: spec.label ?? '?',
      childSessionId: asSessionId('child'),
      text: `OUT_${spec.label ?? '?'}`,
      stopReason: 'end_turn',
    });
    const slowContinue: SubagentSpawner = {
      spawn: spawnOne,
      spawnAll: (list) => Promise.all(list.map(spawnOne)),
      continue: async (args) => {
        continueCalls += 1;
        await new Promise((r) => setTimeout(r, 20)); // hold the claim open
        return {
          label: args.label ?? '?',
          childSessionId: args.childSessionId,
          text: `FINAL_${args.label ?? '?'}`,
          stopReason: 'end_turn',
        };
      },
      release: () => {},
    };
    // Wrap the store so we can count removals (the second resume must not remove).
    const countingStore = {
      load: (id: string) => store.load(id),
      save: (c: Parameters<WorkflowRunStore['save']>[0]) => store.save(c),
      remove: async (id: string) => {
        removeCalls += 1;
        return store.remove(id);
      },
      sweepStale: (...args: Parameters<WorkflowRunStore['sweepStale']>) => store.sweepStale(...args),
    } as unknown as WorkflowRunStore;

    const h = makeHarness({ runStore: store } as Partial<WorkflowRunDeps>);
    const paused = await dagExecutor.run(
      rawWf([
        { id: 'ask', prompt: 'Ask', awaitInput: true },
        { id: 'go', needs: ['ask'], prompt: 'Use {{ steps.ask.output }}' },
      ]),
      h.deps,
    );
    expect(paused.status).toBe('paused');

    const resumeDeps = { ...h.deps, spawner: slowContinue } as WorkflowRunDeps;
    const [a, b] = await Promise.all([
      resumeWorkflowRun(paused.runId!, 'one', resumeDeps, countingStore),
      resumeWorkflowRun(paused.runId!, 'two', resumeDeps, countingStore),
    ]);
    // Exactly one resume proceeded; the other was rejected by the in-flight lock.
    const oks = [a, b].filter((r) => r.ok);
    const rejected = [a, b].find((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(rejected?.error).toMatch(/already being resumed/);
    // The child session was continued exactly once and the checkpoint removed once.
    expect(continueCalls).toBe(1);
    expect(removeCalls).toBe(1);
    await rm(dir, { recursive: true, force: true });
  });

  it('drops prototype-pollution keys from logic-step vars (Finding 6)', async () => {
    const h = makeHarness({
      logicResponses: {
        evil: '{"vars":{"__proto__":{"polluted":true},"safe":"ok"}}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'proto',
        description: 'x',
        steps: [
          { id: 'evil', bridge: 'set vars' },
          { id: 'use', needs: ['evil'], tool: 'notify', args: { v: '{{ vars.safe }}' } },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    // The safe key still merges…
    expect(h.toolCalls[0]!.input).toEqual({ v: 'ok' });
    // …but the prototype is not polluted.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('bridge merges vars for downstream templates', async () => {
    const h = makeHarness({
      logicResponses: {
        extract_email: '{"vars":{"email":"ops@example.com"}}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'bridge-vars',
        description: 'x',
        steps: [
          { id: 'src', prompt: 'chat' },
          { id: 'extract_email', needs: ['src'], bridge: 'extract email to vars.email' },
          { id: 'use', needs: ['extract_email'], tool: 'notify', args: { to: '{{ vars.email }}' } },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(h.toolCalls[0]!.input).toEqual({ to: 'ops@example.com' });
  });

  it('condition skips the inactive branch', async () => {
    const h = makeHarness({ logicResponses: { gate: '{"branch":"then"}' } } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'cond',
        description: 'x',
        steps: [
          { id: 'src', prompt: 'x' },
          { id: 'gate', needs: ['src'], condition: 'branch then or else', then: ['on_then'], else: ['on_else'] },
          { id: 'on_then', needs: ['gate'], prompt: 'then path' },
          { id: 'on_else', needs: ['gate'], prompt: 'else path' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.on_then).toBe('completed');
    expect(byId.on_else).toBe('skipped');
    expect(h.order).not.toContain('on_else');
  });

  it('switch routes to the matching case', async () => {
    const h = makeHarness({ logicResponses: { pick: '{"branch":"kot"}' } } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'sw',
        description: 'x',
        steps: [
          { id: 'parse', bridge: 'vars.wartosc' },
          {
            id: 'pick',
            needs: ['parse'],
            switch: 'pies kot nieokreslony',
            cases: { pies: ['dog'], kot: ['cat'], nieokreslony: ['unk'] },
          },
          { id: 'dog', needs: ['pick'], prompt: 'd' },
          { id: 'cat', needs: ['pick'], prompt: 'c' },
          { id: 'unk', needs: ['pick'], prompt: 'u' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.cat).toBe('completed');
    expect(byId.dog).toBe('skipped');
    expect(byId.unk).toBe('skipped');
  });

  it('fails a logic step on invalid JSON', async () => {
    const h = makeHarness({ logicResponses: { bad: 'not json at all' } } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({ name: 'bad-json', description: 'x', steps: [{ id: 'bad', bridge: 'do thing' }] }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.status).toBe('failed');
  });
});

describe('dag executor — while-loop node', () => {
  // `loop.condition` is the loop's EXIT/GOAL condition: the body repeats UNTIL
  // it is met. The "(condition)" predicate returns branch `then` = condition
  // MET → STOP (continue to the next step), `else` = NOT yet met → run another
  // iteration. A body step error BREAKS the loop to the next step unless that
  // step sets `onError: continue`. The cap always terminates the loop.
  //
  // A loop with a single bridge body step that bumps vars.count, and a
  // condition keyed by the loop's "(condition)" label.
  function loopWf(name: string, maxIterations = 10): Workflow {
    return wf({
      name,
      description: 'x',
      steps: [
        { id: 'seed', prompt: 'seed' },
        { id: 'spin', needs: ['seed'], loop: { body: ['bump'], condition: 'is the goal met? {{ vars.count }}', maxIterations } },
        { id: 'bump', needs: ['spin'], bridge: 'increment vars.count' },
        { id: 'done', needs: ['spin'], prompt: 'use {{ vars.count }}' },
      ],
    });
  }

  it('stops after one iteration when the exit condition is met', async () => {
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        // `then` = condition MET → stop immediately after the first body run.
        'spin (condition)': '{"branch":"then"}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-once'), h.deps);
    expect(result.ok).toBe(true);
    // One body run + one condition eval.
    const bumpRuns = h.order.filter((o) => o === 'bump').length;
    const condRuns = h.order.filter((o) => o === 'spin (condition)').length;
    expect(bumpRuns).toBe(1);
    expect(condRuns).toBe(1);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.spin).toBe('completed');
    expect(byId.bump).toBe('completed');
    expect(byId.done).toBe('completed'); // downstream of the loop runs
  });

  it('repeats until iteration N then stops when the condition is met', async () => {
    // Not met (else) for the first 2 evals, met (then) on the 3rd → 3 body runs.
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        'spin (condition)': (n: number) => (n < 2 ? '{"branch":"else"}' : '{"branch":"then"}'),
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-n'), h.deps);
    expect(result.ok).toBe(true);
    expect(h.order.filter((o) => o === 'bump').length).toBe(3);
    expect(h.order.filter((o) => o === 'spin (condition)').length).toBe(3);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.done).toBe('completed');
  });

  it('stops cleanly at maxIterations without hanging', async () => {
    // Condition is never met (always `else` → run another iteration) — only the
    // cap can stop it.
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        'spin (condition)': '{"branch":"else"}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-cap', 4), h.deps);
    expect(result.ok).toBe(true);
    expect(h.order.filter((o) => o === 'bump').length).toBe(4); // exactly maxIterations
    const spin = result.steps.find((s) => s.id === 'spin')!;
    expect(spin.status).toBe('completed');
    expect(spin.output).toMatch(/max iterations \(4\)/);
  });

  it('makes body vars visible to the condition prompt', async () => {
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":"42"}}',
        'spin (condition)': '{"branch":"then"}', // met → stop after one iteration
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-vars'), h.deps);
    expect(result.ok).toBe(true);
    const condSpec = h.specs.find((s) => s.label === 'spin (condition)')!;
    expect(condSpec.prompt).toContain('42'); // {{ vars.count }} rendered the body's var
    const done = h.specs.find((s) => s.label === 'done')!;
    expect(done.prompt).toContain('42'); // downstream step also sees the var
  });

  it('breaks the loop to the next step when a body step errors (onError=fail)', async () => {
    // A body tool step that always throws, with default/fail onError. The body
    // error BREAKS the loop (loop returns ok with a "broke on error" note)
    // rather than failing the whole workflow, and the downstream step that
    // `needs` the loop still runs.
    let toolCalls = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          toolCalls += 1;
          throw new Error('boom');
        },
      },
      logicResponses: {
        // Should never be consulted: the body breaks first. If it were, `else`
        // would (wrongly) keep iterating — proving the break short-circuits it.
        'spin (condition)': '{"branch":"else"}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'loop-body-error',
        description: 'x',
        steps: [
          { id: 'spin', loop: { body: ['hit'], condition: 'goal met?', maxIterations: 5 } },
          { id: 'hit', needs: ['spin'], tool: 'x', onError: 'fail' },
          { id: 'after', needs: ['spin'], prompt: 'runs after the loop' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true); // body error breaks the loop, does not fail the run
    // Body ran exactly once then broke; the condition was never evaluated.
    expect(toolCalls).toBe(1);
    expect(h.order.filter((o) => o === 'spin (condition)').length).toBe(0);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.spin).toBe('completed');
    expect(byId.after).toBe('completed'); // downstream of the loop RUNS
    const spin = result.steps.find((s) => s.id === 'spin')!;
    expect(spin.output).toMatch(/broke on error/);
  });

  it('swallows a body error and keeps iterating when onError=continue', async () => {
    // A body step with onError=continue errors every iteration; the loop keeps
    // going until the exit condition is met (here on the 2nd condition eval).
    let toolCalls = 0;
    const h = makeHarness({
      tools: {
        get: () => ({}),
        execute: async () => {
          toolCalls += 1;
          throw new Error('flaky');
        },
      },
      logicResponses: {
        'spin (condition)': (n: number) => (n < 1 ? '{"branch":"else"}' : '{"branch":"then"}'),
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'loop-body-continue',
        description: 'x',
        steps: [
          { id: 'spin', loop: { body: ['hit'], condition: 'goal met?', maxIterations: 5 } },
          { id: 'hit', needs: ['spin'], tool: 'x', onError: 'continue' },
          { id: 'after', needs: ['spin'], prompt: 'runs after the loop' },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(true);
    // Error swallowed → loop kept iterating: 2 body runs + 2 condition evals.
    expect(toolCalls).toBe(2);
    expect(h.order.filter((o) => o === 'spin (condition)').length).toBe(2);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.spin).toBe('completed');
    expect(byId.after).toBe('completed');
    const spin = result.steps.find((s) => s.id === 'spin')!;
    expect(spin.output).not.toMatch(/broke on error/); // it was not a break
  });

  it('respects MAX_NESTING_DEPTH when a loop body calls a nested workflow', async () => {
    // A self-referential nested workflow: each level calls itself. The loop's
    // iteration cap is independent of the depth cap; depth must still bottom out.
    const deep: Workflow = wf({
      name: 'deep',
      description: 'x',
      steps: [{ id: 'recurse', workflow: 'deep' }],
    });
    const base = makeHarness();
    const deps: WorkflowRunDeps = {
      ...base.deps,
      lookup: { skill: () => undefined, workflow: (n) => (n === 'deep' ? deep : undefined) },
      logicResponses: {
        // Never reached: the body's depth error breaks the loop first.
        'loopnest (condition)': '{"branch":"else"}',
      },
    } as Partial<WorkflowRunDeps> as WorkflowRunDeps;
    const result = await dagExecutor.run(
      wf({
        name: 'loop-depth',
        description: 'x',
        steps: [
          { id: 'loopnest', loop: { body: ['call'], condition: 'go?', maxIterations: 3 } },
          { id: 'call', needs: ['loopnest'], workflow: 'deep', onError: 'fail' },
          { id: 'after', needs: ['loopnest'], prompt: 'after the loop' },
        ],
      }),
      deps,
    );
    // The body step calls the unbounded-nesting "deep" workflow → the depth
    // guard throws, failing the body step (onError=fail) → the body error
    // BREAKS the loop (loop returns ok), and the downstream step still runs.
    expect(result.ok).toBe(true);
    const loopnest = result.steps.find((s) => s.id === 'loopnest')!;
    expect(loopnest.status).toBe('completed');
    expect(loopnest.output).toMatch(/broke on error/);
    expect(loopnest.output).toMatch(/depth exceeded/);
    const byId = Object.fromEntries(result.steps.map((s) => [s.id, s.status]));
    expect(byId.after).toBe('completed'); // downstream of the loop runs
  });

  it('rejects awaitInput inside a loop body at runtime', async () => {
    // Schema gates awaitInput everywhere now (Finding 1), but the executor
    // still guards against a body step that pauses mid-iteration. Build the
    // workflow raw (bypassing the author-time gate) to exercise that guard.
    const h = makeHarness({
      logicResponses: { 'spin (condition)': '{"branch":"then"}' },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      rawWf([
        { id: 'spin', loop: { body: ['ask'], condition: 'go?', maxIterations: 3 } },
        { id: 'ask', needs: ['spin'], prompt: 'ask something', awaitInput: true },
      ]),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot pause for input/);
  });
});
