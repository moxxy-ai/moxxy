/**
 * Unit tests for the canvas' geometry-free topology derivation.
 *
 * `topoOrder` (the O(V+E) longest-path layering shown as step numbers) and the
 * `topologySignature` that keys its memo. The signature must be STABLE across a
 * position-only move so a node drag — which reallocates `state.nodes` on every
 * pointer-move — doesn't recompute the fold dozens of times per second.
 */
import { describe, expect, it } from 'vitest';
import type { BuilderNode } from '@moxxy/workflows-builder';
import { topoOrder, topologySignature } from './WorkflowCanvas';

/** Minimal BuilderNode — only id/x/y/needs matter to the functions under test. */
function node(id: string, needs: string[] = [], x = 0, y = 0): BuilderNode {
  return {
    id,
    kind: 'prompt',
    x,
    y,
    action: '',
    needs,
    onError: 'fail',
    retries: 0,
  } as unknown as BuilderNode;
}

describe('topoOrder', () => {
  it('numbers a linear chain 1..N in dependency order', () => {
    const nodes = [node('a'), node('b', ['a']), node('c', ['b'])];
    const order = topoOrder(nodes);
    expect(order.get('a')).toBe(1);
    expect(order.get('b')).toBe(2);
    expect(order.get('c')).toBe(3);
  });

  it('breaks depth ties by insertion order', () => {
    // a and b are both roots (depth 0); c depends on both (depth 1).
    const nodes = [node('a'), node('b'), node('c', ['a', 'b'])];
    const order = topoOrder(nodes);
    // roots ranked by insertion index, then the dependent.
    expect(order.get('a')).toBe(1);
    expect(order.get('b')).toBe(2);
    expect(order.get('c')).toBe(3);
  });

  it('uses longest-path depth for diamond dependencies', () => {
    // a → b → d and a → c → d ; d's depth is 2 (longest path), not 1.
    const nodes = [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])];
    const order = topoOrder(nodes);
    expect(order.get('a')).toBe(1);
    expect(order.get('d')).toBe(4); // ranked last (deepest)
  });

  it('does not throw on a cycle and still assigns distinct 1..N ranks', () => {
    const nodes = [node('a', ['b']), node('b', ['a'])];
    expect(() => topoOrder(nodes)).not.toThrow();
    const order = topoOrder(nodes);
    // The cycle-guard breaks the recursion; exact tie order is implementation
    // detail, but every node gets a unique rank in 1..N.
    const ranks = [order.get('a'), order.get('b')].sort();
    expect(ranks).toEqual([1, 2]);
  });

  it('ignores dangling needs (referenced node absent)', () => {
    const nodes = [node('a', ['ghost'])];
    const order = topoOrder(nodes);
    expect(order.get('a')).toBe(1);
  });
});

describe('topologySignature', () => {
  it('is identical for a position-only move (the drag fast-path)', () => {
    const before = [node('a', [], 0, 0), node('b', ['a'], 100, 0)];
    // Same ids + needs, only x/y moved — as a drag produces.
    const afterDrag = [node('a', [], 37, 12), node('b', ['a'], 240, 99)];
    expect(topologySignature(afterDrag)).toBe(topologySignature(before));
  });

  it('changes when a needs edge is added', () => {
    const before = [node('a'), node('b')];
    const after = [node('a'), node('b', ['a'])];
    expect(topologySignature(after)).not.toBe(topologySignature(before));
  });

  it('changes when a node is added or the set reorders', () => {
    const base = [node('a'), node('b')];
    expect(topologySignature([...base, node('c')])).not.toBe(topologySignature(base));
    expect(topologySignature([node('b'), node('a')])).not.toBe(topologySignature(base));
  });
});
