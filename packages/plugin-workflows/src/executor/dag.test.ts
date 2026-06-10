import {
  asSessionId,
  type Skill,
  type SubagentResult,
  type SubagentSpec,
  type SubagentSpawner,
  type Workflow,
  type WorkflowRunDeps,
} from '@moxxy/sdk';
import { mkdtemp, rm } from 'node:fs/promises';
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
      wf({
        name: 'ask-then-go',
        description: 'x',
        steps: [
          { id: 'ask', prompt: 'Ask for brief', awaitInput: true },
          { id: 'go', needs: ['ask'], prompt: 'Use {{ steps.ask.output }}' },
        ],
      }),
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
  // A loop with a single bridge body step that bumps vars.count, and a
  // condition keyed by the loop's "(condition)" label.
  function loopWf(name: string, maxIterations = 10): Workflow {
    return wf({
      name,
      description: 'x',
      steps: [
        { id: 'seed', prompt: 'seed' },
        { id: 'spin', needs: ['seed'], loop: { body: ['bump'], condition: 'keep going? {{ vars.count }}', maxIterations } },
        { id: 'bump', needs: ['spin'], bridge: 'increment vars.count' },
        { id: 'done', needs: ['spin'], prompt: 'use {{ vars.count }}' },
      ],
    });
  }

  it('runs the body once when the condition stops on iteration 1', async () => {
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        'spin (condition)': '{"branch":"else"}', // stop immediately after first body run
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
    expect(byId.done).toBe('completed');
  });

  it('repeats until iteration N then stops', async () => {
    // Continue for the first 2 condition evals, stop on the 3rd → 3 body runs.
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        'spin (condition)': (n: number) => (n < 2 ? '{"branch":"then"}' : '{"branch":"else"}'),
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-n'), h.deps);
    expect(result.ok).toBe(true);
    expect(h.order.filter((o) => o === 'bump').length).toBe(3);
    expect(h.order.filter((o) => o === 'spin (condition)').length).toBe(3);
  });

  it('stops cleanly at maxIterations without hanging', async () => {
    // Condition always says "then" (keep going) — only the cap can stop it.
    const h = makeHarness({
      logicResponses: {
        bump: '{"vars":{"count":1}}',
        'spin (condition)': '{"branch":"then"}',
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
        'spin (condition)': '{"branch":"else"}',
      },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(loopWf('loop-vars'), h.deps);
    expect(result.ok).toBe(true);
    const condSpec = h.specs.find((s) => s.label === 'spin (condition)')!;
    expect(condSpec.prompt).toContain('42'); // {{ vars.count }} rendered the body's var
    const done = h.specs.find((s) => s.label === 'done')!;
    expect(done.prompt).toContain('42'); // downstream step also sees the var
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
        call: '{"text":"ok"}',
        'loopnest (condition)': '{"branch":"else"}', // one iteration
      },
    } as Partial<WorkflowRunDeps> as WorkflowRunDeps;
    const result = await dagExecutor.run(
      wf({
        name: 'loop-depth',
        description: 'x',
        steps: [
          { id: 'loopnest', loop: { body: ['call'], condition: 'go?', maxIterations: 3 } },
          { id: 'call', needs: ['loopnest'], workflow: 'deep', onError: 'fail' },
        ],
      }),
      deps,
    );
    // The body step calls the unbounded-nesting "deep" workflow → the depth
    // guard throws, failing the body step (onError=fail) → the loop aborts.
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/depth exceeded/);
  });

  it('rejects awaitInput inside a loop body at runtime', async () => {
    // Schema bars awaitInput on the loop step itself; a body prompt with
    // awaitInput would pause mid-iteration — the loop fails loudly instead.
    const h = makeHarness({
      logicResponses: { 'spin (condition)': '{"branch":"else"}' },
    } as Partial<WorkflowRunDeps>);
    const result = await dagExecutor.run(
      wf({
        name: 'loop-await-body',
        description: 'x',
        steps: [
          { id: 'spin', loop: { body: ['ask'], condition: 'go?', maxIterations: 3 } },
          { id: 'ask', needs: ['spin'], prompt: 'ask something', awaitInput: true },
        ],
      }),
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cannot pause for input/);
  });
});
