import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '@moxxy/sdk';
import { assertDefined } from './assert.js';
import {
  addStep,
  emptyState,
  setBranchTargets,
  setLoopBody,
  setLoopConfig,
  setLoopExit,
  setSwitchCase,
  updateMeta,
  updateNode,
} from './operations.js';
import { autoLayout, hydrate, hydrateYaml, serialize } from './serialize.js';
import { fromYaml, toYaml } from './yaml.js';

/** A fully-typed minimal WorkflowStep for layout fixtures (autoLayout reads
 *  only `id` + `needs`, but we supply the required fields so no `as never`
 *  cast is needed and a future field rename surfaces here). */
function step(id: string, needs: string[] = []): WorkflowStep {
  return { id, needs, onError: 'fail', retries: 0, prompt: `do ${id}` };
}

function refineFixture() {
  let s = emptyState('refine-draft');
  s = updateMeta(s, { description: 'Draft then refine until good enough.' });
  s = addStep(s, { kind: 'prompt', id: 'first_draft', label: 'First draft' });
  s = updateNode(s, 'first_draft', { action: 'Write a first draft about {{ inputs.topic }}.\nKeep it short.' });
  s = addStep(s, { kind: 'loop', id: 'refine', label: 'Refine loop', after: 'first_draft' });
  s = addStep(s, { kind: 'bridge', id: 'improve', label: 'Improve' });
  s = updateNode(s, 'improve', { action: 'Improve the draft. Return JSON vars.draft.' });
  s = addStep(s, { kind: 'prompt', id: 'finish', label: 'Finish' });
  s = updateNode(s, 'finish', { action: 'Emit the final draft.' });
  s = setLoopBody(s, 'refine', ['improve']);
  s = setLoopExit(s, 'refine', 'finish');
  s = setLoopConfig(s, 'refine', { condition: 'Is the draft good enough?', maxIterations: 5 });
  return s;
}

describe('serialize → Workflow', () => {
  it('builds a Workflow object + ui.layout from the canvas', () => {
    const s = refineFixture();
    const { workflow, yaml } = serialize(s);
    expect(workflow.name).toBe('refine-draft');
    expect(workflow.steps).toHaveLength(4);
    const loop = workflow.steps.find((st) => st.id === 'refine');
    assertDefined(loop, 'refine step');
    expect(loop.loop).toEqual({ body: ['improve'], condition: 'Is the draft good enough?', maxIterations: 5 });
    // body + exit steps carry needs:[refine]
    const improve = workflow.steps.find((st) => st.id === 'improve');
    assertDefined(improve, 'improve step');
    expect(improve.needs).toContain('refine');
    const finish = workflow.steps.find((st) => st.id === 'finish');
    assertDefined(finish, 'finish step');
    expect(finish.needs).toContain('refine');
    const layout = workflow.ui?.layout;
    assertDefined(layout, 'ui layout');
    expect(layout.nodes.first_draft).toBeDefined();
    expect(layout.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(yaml).toContain('name: refine-draft');
    expect(yaml).toContain('loop:');
  });

  it('round-trips targetSessionId through serialize → hydrate → hydrateYaml', () => {
    let s = refineFixture();
    s = updateMeta(s, { targetSessionId: 'desk-B' });
    const { workflow, yaml } = serialize(s);
    // Survives serialize (the field-by-field serializer would otherwise drop it).
    expect(workflow.targetSessionId).toBe('desk-B');
    expect(yaml).toContain('targetSessionId: desk-B');
    // ...and the inverse: hydrate from the object and from the YAML both keep it.
    expect(hydrate(workflow).meta.targetSessionId).toBe('desk-B');
    expect(hydrateYaml(yaml).meta.targetSessionId).toBe('desk-B');
  });

  it('serializes multiline prompts as block scalars that round-trip', () => {
    const s = refineFixture();
    const { yaml } = serialize(s);
    expect(yaml).toMatch(/prompt: \|/);
    const parsed = fromYaml(yaml) as { steps: Array<{ id: string; prompt?: string }> };
    const draft = parsed.steps.find((st) => st.id === 'first_draft');
    assertDefined(draft, 'first_draft step');
    expect(draft.prompt).toContain('Write a first draft');
    expect(draft.prompt).toContain('Keep it short.');
  });
});

describe('hydrate ← Workflow (round-trip)', () => {
  it('round-trips loop body + exit + branches + layout', () => {
    const original = refineFixture();
    const { workflow } = serialize(original);
    const re = hydrate(workflow);

    expect(re.nodes.map((n) => n.id).sort()).toEqual(['finish', 'first_draft', 'improve', 'refine']);
    const loop = re.nodes.find((n) => n.id === 'refine');
    assertDefined(loop, 'refine node');
    expect(loop.kind).toBe('loop');
    expect(loop.loop).toEqual({ body: ['improve'], condition: 'Is the draft good enough?', maxIterations: 5 });
    // loop-body + single loop-exit edges survive the round-trip
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'loop-body', from: 'refine', to: 'improve' }));
    expect(re.edges.filter((e) => e.kind === 'loop-exit')).toHaveLength(1);
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'loop-exit', from: 'refine', to: 'finish' }));
    // positions preserved from ui.layout
    const firstDraftNode = re.nodes.find((n) => n.id === 'first_draft');
    assertDefined(firstDraftNode, 'first_draft node');
    const layout = workflow.ui?.layout;
    assertDefined(layout, 'ui layout');
    const laidOut = layout.nodes.first_draft;
    assertDefined(laidOut, 'first_draft layout position');
    expect(firstDraftNode.x).toBe(laidOut.x);
  });

  it('round-trips condition + switch branch edges', () => {
    let s = emptyState('routing');
    s = updateMeta(s, { description: 'Route on a predicate.' });
    for (const id of ['gate', 'a', 'b', 'sw', 'hi', 'lo', 'fb']) {
      const kind = id === 'gate' ? 'condition' : id === 'sw' ? 'switch' : 'prompt';
      s = addStep(s, { kind, id });
      if (kind === 'prompt') s = updateNode(s, id, { action: `do ${id}` });
    }
    s = updateNode(s, 'gate', { action: 'is it good?' });
    s = updateNode(s, 'sw', { action: 'how big?' });
    s = setBranchTargets(s, 'gate', 'then', ['a']);
    s = setBranchTargets(s, 'gate', 'else', ['b']);
    s = setSwitchCase(s, 'sw', 'high', ['hi']);
    s = setSwitchCase(s, 'sw', 'low', ['lo']);
    s = setBranchTargets(s, 'sw', 'default', ['fb']);

    const { workflow } = serialize(s);
    const re = hydrate(workflow);
    const gate = re.nodes.find((n) => n.id === 'gate');
    assertDefined(gate, 'gate node');
    expect(gate.then).toEqual(['a']);
    const sw = re.nodes.find((n) => n.id === 'sw');
    assertDefined(sw, 'sw node');
    expect(sw.cases).toEqual({ high: ['hi'], low: ['lo'] });
    expect(sw.default).toEqual(['fb']);
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'then', from: 'gate', to: 'a' }));
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'case', caseId: 'high', from: 'sw', to: 'hi' }));
  });

  it('hydrateYaml parses canonical YAML back into a canvas', () => {
    const { yaml } = serialize(refineFixture());
    const re = hydrateYaml(yaml);
    const refine = re.nodes.find((n) => n.id === 'refine');
    assertDefined(refine, 'refine node');
    const cfg = refine.loop;
    assertDefined(cfg, 'refine loop config');
    expect(cfg.condition).toBe('Is the draft good enough?');
    expect(re.dirty).toBe(false);
  });
});

describe('auto-layout when ui.layout is absent', () => {
  it('lays nodes left-to-right by longest-path depth', () => {
    let s = emptyState('chain');
    s = updateMeta(s, { description: 'linear chain' });
    s = addStep(s, { kind: 'prompt', id: 'a' });
    s = addStep(s, { kind: 'prompt', id: 'b', after: 'a' });
    s = addStep(s, { kind: 'prompt', id: 'c', after: 'b' });
    const { workflow } = serialize(s);
    // strip ui so hydrate must auto-layout
    const bare = { ...workflow, ui: undefined };
    const re = hydrate(bare);
    const x = (id: string) => {
      const node = re.nodes.find((n) => n.id === id);
      assertDefined(node, `node ${id}`);
      return node.x;
    };
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('c'));
  });

  it('autoLayout assigns increasing columns by depth', () => {
    const positions = autoLayout([step('a'), step('b', ['a']), step('c', ['a'])]);
    const [p0, p1, p2] = positions;
    assertDefined(p0, 'position 0');
    assertDefined(p1, 'position 1');
    assertDefined(p2, 'position 2');
    expect(p0.x).toBeLessThan(p1.x);
    // b and c are siblings at the same depth → same column, stacked rows
    expect(p1.x).toBe(p2.x);
    expect(p1.y).not.toBe(p2.y);
  });
});

describe('hydrateYaml hardening — malformed / hand-authored drafts', () => {
  it('coerces a non-array `steps:` to an empty canvas (no TypeError crash)', () => {
    // `steps` typo'd as a map — the old `(raw.steps ?? []).map` threw an opaque
    // "raw.steps.map is not a function". Now it degrades to an empty step list.
    const yaml = 'name: bad\nsteps:\n  id: a\n';
    let re!: ReturnType<typeof hydrateYaml>;
    expect(() => {
      re = hydrateYaml(yaml);
    }).not.toThrow();
    expect(re.nodes).toEqual([]);
  });

  it('rejects a non-object step entry (a bare string list item)', () => {
    const yaml = 'name: bad\nsteps:\n  - just-a-string\n';
    expect(() => hydrateYaml(yaml)).toThrow(/not an object/);
  });

  it('rejects a step with no valid id instead of producing id: undefined', () => {
    const yaml = 'name: bad\nsteps:\n  - prompt: hi\n    needs: []\n';
    expect(() => hydrateYaml(yaml)).toThrow(/no valid id/);
  });

  it('coerces malformed branch/loop shapes to safe empties instead of spreading chars', () => {
    // `then` parsed as a scalar string and `cases`/`needs` as wrong shapes must
    // NOT become a char-spread array; hydrate must yield a clean, usable node.
    const wf = {
      name: 'w',
      description: '',
      version: 1,
      enabled: true,
      inputs: {},
      concurrency: 4,
      steps: [
        { id: 'c', condition: 'q?', then: 'oops', else: ['ok'], needs: ['x', 7], onError: 'fail', retries: 0 },
      ],
    } as unknown as import('@moxxy/sdk').Workflow;
    const re = hydrate(wf);
    const node = re.nodes.find((n) => n.id === 'c');
    assertDefined(node, 'node c');
    // `then` was not an array → dropped, not spread into ['o','o','p','s'].
    expect(node.then).toBeUndefined();
    expect(node.else).toEqual(['ok']);
    // non-string needs entries filtered out, no NaN/number ids leak in.
    expect(node.needs).toEqual(['x']);
  });

  it('does not overflow the stack on a very long linear needs chain', () => {
    const steps = Array.from({ length: 5000 }, (_, i) =>
      step(`s${i}`, i === 0 ? [] : [`s${i - 1}`]),
    );
    expect(() => autoLayout(steps)).not.toThrow();
    const positions = autoLayout(steps);
    const first = positions[0];
    const last = positions[4999];
    assertDefined(first, 'position 0');
    assertDefined(last, 'position 4999');
    // depth strictly increases along the chain.
    expect(first.x).toBeLessThan(last.x);
  });
});

describe('yaml codec edge cases', () => {
  it('round-trips empty lists, numbers, booleans, and quoted strings', () => {
    const value = {
      name: 'x',
      enabled: true,
      version: 2,
      inputs: {},
      steps: [{ id: 'a', needs: [], tags: ['x', 'y'], note: 'has: colon' }],
    };
    const back = fromYaml(toYaml(value));
    expect(back).toEqual(value);
  });

  it('preserves `#` inside block-scalar prompt bodies (no comment stripping)', () => {
    // Prompts are emitted as `|` block scalars and routinely contain `#`:
    // markdown headings, inline `text # note`, and full-line `#`-leading lines.
    // None of these are YAML comments — they must survive the round-trip.
    const prompt = '# Rules\nWrite about it.\nbe terse # but complete\n## Heading two';
    const value = {
      name: 'p',
      steps: [{ id: 'a', prompt, after: 'plain' }],
    };
    const back = fromYaml(toYaml(value)) as typeof value;
    // The `|` block scalar keeps a trailing newline (clip chomping); the body
    // content — including every `#` — must be intact and uncorrupted.
    const firstStep = back.steps[0];
    assertDefined(firstStep, 'first step');
    expect(firstStep.prompt.replace(/\n$/, '')).toBe(prompt);
    // A genuine trailing comment on a structural (non-block) line is still stripped.
    expect(firstStep.after).toBe('plain');
  });
});
