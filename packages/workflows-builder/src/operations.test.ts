import { describe, expect, it } from 'vitest';
import {
  addStep,
  connectNeeds,
  disconnectNeeds,
  emptyState,
  moveNode,
  removeStep,
  removeSwitchCase,
  renameNode,
  setBranchTargets,
  setLoopBody,
  setLoopConfig,
  setLoopExit,
  setSwitchCase,
  uniqueId,
  updateMeta,
  updateNode,
  wouldCreateCycle,
} from './operations.js';
import { loopExitTarget } from './serialize.js';

describe('addStep / removeStep', () => {
  it('adds a node, selects it, flips dirty', () => {
    const s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0]!.id).toBe('a');
    expect(s.selected).toBe('a');
    expect(s.dirty).toBe(true);
  });

  it('uniquifies a colliding id', () => {
    let s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    s = addStep(s, { kind: 'prompt', id: 'a' });
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'a_2']);
  });

  it('wires `after` into a needs edge', () => {
    let s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    s = addStep(s, { kind: 'prompt', id: 'b', after: 'a' });
    expect(s.nodes.find((n) => n.id === 'b')!.needs).toEqual(['a']);
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'needs', from: 'a', to: 'b' }));
  });

  it('removes a node and scrubs all references to it', () => {
    let s = emptyState();
    s = addStep(s, { kind: 'prompt', id: 'a' });
    s = addStep(s, { kind: 'condition', id: 'c' });
    s = addStep(s, { kind: 'prompt', id: 'b', after: 'a' });
    s = setBranchTargets(s, 'c', 'then', ['b']);
    s = removeStep(s, 'b');
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(s.nodes.find((n) => n.id === 'c')!.then).toEqual([]);
    expect(s.edges.some((e) => e.to === 'b')).toBe(false);
  });
});

describe('needs edges', () => {
  it('connect/disconnect are idempotent and ignore self', () => {
    let s = addStep(addStep(emptyState(), { kind: 'prompt', id: 'a' }), { kind: 'prompt', id: 'b' });
    s = connectNeeds(s, 'a', 'b');
    s = connectNeeds(s, 'a', 'b'); // dup ignored
    s = connectNeeds(s, 'b', 'b'); // self ignored
    expect(s.nodes.find((n) => n.id === 'b')!.needs).toEqual(['a']);
    s = disconnectNeeds(s, 'a', 'b');
    expect(s.nodes.find((n) => n.id === 'b')!.needs).toEqual([]);
  });

  it('refuses a connection that would create a cycle', () => {
    let s = emptyState();
    for (const id of ['a', 'b', 'c']) s = addStep(s, { kind: 'prompt', id });
    s = connectNeeds(s, 'a', 'b'); // a → b
    s = connectNeeds(s, 'b', 'c'); // b → c
    expect(wouldCreateCycle(s, 'c', 'a')).toBe(true); // c → a closes a→b→c→a
    const before = s;
    s = connectNeeds(s, 'c', 'a');
    expect(s).toBe(before); // no-op, no cycle authored
    expect(s.nodes.find((n) => n.id === 'a')!.needs).toEqual([]);
    // the reverse direction (already implied) is fine and idempotent
    expect(wouldCreateCycle(s, 'a', 'c')).toBe(false);
  });
});

describe('branch targets', () => {
  it('sets condition then/else and derives labeled edges', () => {
    let s = emptyState();
    for (const id of ['c', 'x', 'y']) s = addStep(s, { kind: id === 'c' ? 'condition' : 'prompt', id });
    s = setBranchTargets(s, 'c', 'then', ['x']);
    s = setBranchTargets(s, 'c', 'else', ['y']);
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'then', from: 'c', to: 'x' }));
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'else', from: 'c', to: 'y' }));
  });

  it('switch cases + default produce case/default edges with caseId', () => {
    let s = emptyState();
    for (const id of ['sw', 'hi', 'lo', 'fb']) s = addStep(s, { kind: id === 'sw' ? 'switch' : 'prompt', id });
    s = setSwitchCase(s, 'sw', 'high', ['hi']);
    s = setSwitchCase(s, 'sw', 'low', ['lo']);
    s = setBranchTargets(s, 'sw', 'default', ['fb']);
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'case', from: 'sw', to: 'hi', caseId: 'high' }));
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'default', from: 'sw', to: 'fb' }));
    s = removeSwitchCase(s, 'sw', 'low');
    expect(s.nodes.find((n) => n.id === 'sw')!.cases).toEqual({ high: ['hi'] });
  });
});

describe('loop node body + exit model', () => {
  function loopFixture() {
    let s = emptyState();
    s = addStep(s, { kind: 'prompt', id: 'seed' });
    s = addStep(s, { kind: 'loop', id: 'loop', after: 'seed' });
    s = addStep(s, { kind: 'bridge', id: 'improve' });
    s = addStep(s, { kind: 'prompt', id: 'finish' });
    return s;
  }

  it('setLoopBody scopes body steps to the loop via needs and derives loop-body edges', () => {
    let s = loopFixture();
    s = setLoopBody(s, 'loop', ['improve']);
    expect(s.nodes.find((n) => n.id === 'loop')!.loop!.body).toEqual(['improve']);
    expect(s.nodes.find((n) => n.id === 'improve')!.needs).toEqual(['loop']);
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'loop-body', from: 'loop', to: 'improve' }));
    // body step's needs:[loop] is NOT rendered as a plain needs edge.
    expect(s.edges.some((e) => e.kind === 'needs' && e.from === 'loop' && e.to === 'improve')).toBe(false);
  });

  it('dropping a step from the body removes its loop needs', () => {
    let s = loopFixture();
    s = setLoopBody(s, 'loop', ['improve']);
    s = setLoopBody(s, 'loop', []);
    expect(s.nodes.find((n) => n.id === 'improve')!.needs).toEqual([]);
    expect(s.nodes.find((n) => n.id === 'loop')!.loop!.body).toEqual([]);
  });

  it('setLoopExit wires the single exit needs edge and re-points it', () => {
    let s = loopFixture();
    s = setLoopBody(s, 'loop', ['improve']);
    s = setLoopExit(s, 'loop', 'finish');
    expect(loopExitTarget(s.nodes.find((n) => n.id === 'loop')!, s.nodes)).toBe('finish');
    expect(s.edges).toContainEqual(expect.objectContaining({ kind: 'loop-exit', from: 'loop', to: 'finish' }));
    // exactly one loop-exit edge per loop
    expect(s.edges.filter((e) => e.kind === 'loop-exit')).toHaveLength(1);
    // detach
    s = setLoopExit(s, 'loop', null);
    expect(s.edges.some((e) => e.kind === 'loop-exit')).toBe(false);
  });

  it('refuses to make a body step the exit', () => {
    let s = loopFixture();
    s = setLoopBody(s, 'loop', ['improve']);
    const before = s;
    s = setLoopExit(s, 'loop', 'improve');
    expect(s).toBe(before); // no-op
  });

  it('setLoopConfig clamps maxIterations to 1..50', () => {
    let s = loopFixture();
    s = setLoopConfig(s, 'loop', { maxIterations: 999, condition: 'good enough?' });
    expect(s.nodes.find((n) => n.id === 'loop')!.loop!.maxIterations).toBe(50);
    s = setLoopConfig(s, 'loop', { maxIterations: 0 });
    expect(s.nodes.find((n) => n.id === 'loop')!.loop!.maxIterations).toBe(1);
  });
});

describe('updateNode / updateMeta / move / rename', () => {
  it('patches action text without touching topology', () => {
    let s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    const edgesRef = s.edges;
    s = updateNode(s, 'a', { action: 'do the thing', label: 'Step A' });
    expect(s.nodes[0]!.action).toBe('do the thing');
    expect(s.nodes[0]!.label).toBe('Step A');
    expect(s.edges).toBe(edgesRef);
  });

  it('clamps retries to 0..3', () => {
    let s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    s = updateNode(s, 'a', { retries: 9 });
    expect(s.nodes[0]!.retries).toBe(3);
  });

  it('moveNode updates position, keeps edges', () => {
    let s = addStep(emptyState(), { kind: 'prompt', id: 'a' });
    const ref = s.edges;
    s = moveNode(s, 'a', 123, 456);
    expect(s.nodes[0]).toMatchObject({ x: 123, y: 456 });
    expect(s.edges).toBe(ref);
  });

  it('updateMeta patches workflow fields', () => {
    const s = updateMeta(emptyState(), { name: 'renamed', enabled: false });
    expect(s.meta.name).toBe('renamed');
    expect(s.meta.enabled).toBe(false);
  });

  it('renameNode rewrites every reference', () => {
    let s = emptyState();
    s = addStep(s, { kind: 'condition', id: 'c' });
    s = addStep(s, { kind: 'prompt', id: 'old', after: 'c' });
    s = setBranchTargets(s, 'c', 'then', ['old']);
    s = renameNode(s, 'old', 'fresh');
    expect(s.nodes.map((n) => n.id)).toContain('fresh');
    expect(s.nodes.find((n) => n.id === 'c')!.then).toEqual(['fresh']);
    expect(s.nodes.find((n) => n.id === 'fresh')!.needs).toEqual(['c']);
  });
});

describe('uniqueId', () => {
  it('slugifies and de-dupes', () => {
    const s = addStep(emptyState(), { kind: 'prompt', id: 'my step' });
    expect(s.nodes[0]!.id).toBe('my_step');
    expect(uniqueId(s, 'my step')).toBe('my_step_2');
  });
});
