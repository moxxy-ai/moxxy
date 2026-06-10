import { describe, expect, it } from 'vitest';
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
    const loop = workflow.steps.find((st) => st.id === 'refine')!;
    expect(loop.loop).toEqual({ body: ['improve'], condition: 'Is the draft good enough?', maxIterations: 5 });
    // body + exit steps carry needs:[refine]
    expect(workflow.steps.find((st) => st.id === 'improve')!.needs).toContain('refine');
    expect(workflow.steps.find((st) => st.id === 'finish')!.needs).toContain('refine');
    expect(workflow.ui?.layout?.nodes.first_draft).toBeDefined();
    expect(workflow.ui?.layout?.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(yaml).toContain('name: refine-draft');
    expect(yaml).toContain('loop:');
  });

  it('serializes multiline prompts as block scalars that round-trip', () => {
    const s = refineFixture();
    const { yaml } = serialize(s);
    expect(yaml).toMatch(/prompt: \|/);
    const parsed = fromYaml(yaml) as { steps: Array<{ id: string; prompt?: string }> };
    const draft = parsed.steps.find((st) => st.id === 'first_draft')!;
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
    const loop = re.nodes.find((n) => n.id === 'refine')!;
    expect(loop.kind).toBe('loop');
    expect(loop.loop).toEqual({ body: ['improve'], condition: 'Is the draft good enough?', maxIterations: 5 });
    // loop-body + single loop-exit edges survive the round-trip
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'loop-body', from: 'refine', to: 'improve' }));
    expect(re.edges.filter((e) => e.kind === 'loop-exit')).toHaveLength(1);
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'loop-exit', from: 'refine', to: 'finish' }));
    // positions preserved from ui.layout
    expect(re.nodes.find((n) => n.id === 'first_draft')!.x).toBe(workflow.ui!.layout!.nodes.first_draft!.x);
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
    expect(re.nodes.find((n) => n.id === 'gate')!.then).toEqual(['a']);
    expect(re.nodes.find((n) => n.id === 'sw')!.cases).toEqual({ high: ['hi'], low: ['lo'] });
    expect(re.nodes.find((n) => n.id === 'sw')!.default).toEqual(['fb']);
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'then', from: 'gate', to: 'a' }));
    expect(re.edges).toContainEqual(expect.objectContaining({ kind: 'case', caseId: 'high', from: 'sw', to: 'hi' }));
  });

  it('hydrateYaml parses canonical YAML back into a canvas', () => {
    const { yaml } = serialize(refineFixture());
    const re = hydrateYaml(yaml);
    expect(re.nodes.find((n) => n.id === 'refine')!.loop!.condition).toBe('Is the draft good enough?');
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
    const x = (id: string) => re.nodes.find((n) => n.id === id)!.x;
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('c'));
  });

  it('autoLayout assigns increasing columns by depth', () => {
    const positions = autoLayout([
      { id: 'a', needs: [] } as never,
      { id: 'b', needs: ['a'] } as never,
      { id: 'c', needs: ['a'] } as never,
    ]);
    expect(positions[0]!.x).toBeLessThan(positions[1]!.x);
    // b and c are siblings at the same depth → same column, stacked rows
    expect(positions[1]!.x).toBe(positions[2]!.x);
    expect(positions[1]!.y).not.toBe(positions[2]!.y);
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
});
