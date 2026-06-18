/**
 * Unit tests for the canvas' pure graph + geometry helpers.
 *
 * These were buried in `WorkflowCanvas.tsx`; extracting them into a React-free
 * module lets the topology fold, hit-testing, drop-region math, and the
 * disconnect-op routing be tested directly without rendering the canvas.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BuilderAction, BuilderEdge, BuilderNode } from '@moxxy/workflows-builder';
import {
  ANCHOR_OFFSET,
  NODE_H,
  NODE_W,
  disconnectEdge,
  inBodyRegion,
  isEditableTarget,
  labelOf,
  nodeAt,
  portOrigin,
  preview,
  topoOrder,
  topologySignature,
} from './canvas-graph';

/** Minimal BuilderNode — only the fields each test touches matter. */
function node(id: string, extra: Partial<BuilderNode> = {}): BuilderNode {
  return {
    id,
    kind: 'prompt',
    x: 0,
    y: 0,
    action: '',
    needs: [],
    onError: 'fail',
    retries: 0,
    ...extra,
  } as unknown as BuilderNode;
}

describe('portOrigin', () => {
  it('anchors needs/loop-exit at the node centre on the right edge', () => {
    const n = node('a', { x: 100, y: 50 });
    expect(portOrigin(n, 'needs')).toEqual({ x: 100 + NODE_W, y: 50 + ANCHOR_OFFSET });
    expect(portOrigin(n, 'loop-exit')).toEqual({ x: 100 + NODE_W, y: 50 + ANCHOR_OFFSET });
  });

  it('offsets then above and else below the centre', () => {
    const n = node('a', { x: 0, y: 0 });
    expect(portOrigin(n, 'then')).toEqual({ x: NODE_W, y: ANCHOR_OFFSET - 14 });
    expect(portOrigin(n, 'else')).toEqual({ x: NODE_W, y: ANCHOR_OFFSET + 14 });
  });
});

describe('inBodyRegion', () => {
  it('is true on/below the loop card vertical midpoint, false above', () => {
    const loop = node('l', { x: 0, y: 100 });
    // Midpoint is y = 100 + ANCHOR_OFFSET.
    expect(inBodyRegion(loop, { x: 10, y: 100 + ANCHOR_OFFSET })).toBe(true);
    expect(inBodyRegion(loop, { x: 10, y: 100 + ANCHOR_OFFSET + 5 })).toBe(true);
    expect(inBodyRegion(loop, { x: 10, y: 100 + ANCHOR_OFFSET - 5 })).toBe(false);
  });
});

describe('nodeAt', () => {
  const a = node('a', { x: 0, y: 0 });
  const b = node('b', { x: 300, y: 0 });
  const nodes = [a, b];

  it('returns the node whose card contains the point', () => {
    expect(nodeAt(nodes, { x: 10, y: 10 }, '')).toBe('a');
    expect(nodeAt(nodes, { x: 310, y: 10 }, '')).toBe('b');
  });

  it('returns null on empty canvas', () => {
    expect(nodeAt(nodes, { x: 1000, y: 1000 }, '')).toBeNull();
  });

  it('excludes the dragged node so it never targets itself', () => {
    expect(nodeAt(nodes, { x: 10, y: 10 }, 'a')).toBeNull();
  });

  it('hit-tests the card bounds inclusively at the edges', () => {
    expect(nodeAt(nodes, { x: 0, y: 0 }, '')).toBe('a');
    expect(nodeAt(nodes, { x: NODE_W, y: NODE_H }, '')).toBe('a');
  });

  it('a node drawn later (on top) wins when cards overlap', () => {
    const lower = node('lower', { x: 0, y: 0 });
    const upper = node('upper', { x: 0, y: 0 });
    expect(nodeAt([lower, upper], { x: 10, y: 10 }, '')).toBe('upper');
  });
});

describe('disconnectEdge', () => {
  function run(edge: BuilderEdge, from: BuilderNode): BuilderAction[] {
    const calls: BuilderAction[] = [];
    disconnectEdge((a) => calls.push(a), edge, from);
    return calls;
  }

  it('needs → disconnect-needs with the same endpoints', () => {
    const edge = { id: 'e', kind: 'needs', from: 'a', to: 'b' } as BuilderEdge;
    expect(run(edge, node('a'))).toEqual([{ type: 'disconnect-needs', from: 'a', to: 'b' }]);
  });

  it('then → re-sets the branch slot with the target filtered out', () => {
    const edge = { id: 'e', kind: 'then', from: 'a', to: 'b' } as BuilderEdge;
    const from = node('a', { then: ['b', 'c'] } as Partial<BuilderNode>);
    expect(run(edge, from)).toEqual([
      { type: 'set-branch', nodeId: 'a', slot: 'then', targets: ['c'] },
    ]);
  });

  it('else → re-sets the else slot with the target filtered out', () => {
    const edge = { id: 'e', kind: 'else', from: 'a', to: 'b' } as BuilderEdge;
    const from = node('a', { else: ['b'] } as Partial<BuilderNode>);
    expect(run(edge, from)).toEqual([
      { type: 'set-branch', nodeId: 'a', slot: 'else', targets: [] },
    ]);
  });

  it('default → re-sets the default slot with the target filtered out', () => {
    const edge = { id: 'e', kind: 'default', from: 'a', to: 'b' } as BuilderEdge;
    const from = node('a', { default: ['b', 'd'] } as Partial<BuilderNode>);
    expect(run(edge, from)).toEqual([
      { type: 'set-branch', nodeId: 'a', slot: 'default', targets: ['d'] },
    ]);
  });

  it('case → re-sets the matching case targets, keyed by caseId', () => {
    const edge = { id: 'e', kind: 'case', from: 'a', to: 'b', caseId: 'k' } as BuilderEdge;
    const from = node('a', { cases: { k: ['b', 'x'] } } as Partial<BuilderNode>);
    expect(run(edge, from)).toEqual([
      { type: 'set-case', nodeId: 'a', caseId: 'k', targets: ['x'] },
    ]);
  });

  it('loop-body → re-sets the loop body with the target removed', () => {
    const edge = { id: 'e', kind: 'loop-body', from: 'a', to: 'b' } as BuilderEdge;
    const from = node('a', { loop: { body: ['b', 'c'], maxIterations: 10 } } as Partial<BuilderNode>);
    expect(run(edge, from)).toEqual([
      { type: 'set-loop-body', loopId: 'a', body: ['c'] },
    ]);
  });

  it('loop-exit → clears the loop exit target', () => {
    const edge = { id: 'e', kind: 'loop-exit', from: 'a', to: 'b' } as BuilderEdge;
    expect(run(edge, node('a'))).toEqual([
      { type: 'set-loop-exit', loopId: 'a', targetId: null },
    ]);
  });

  it('dispatches exactly once per edge', () => {
    const dispatch = vi.fn();
    disconnectEdge(dispatch, { id: 'e', kind: 'needs', from: 'a', to: 'b' } as BuilderEdge, node('a'));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('isEditableTarget', () => {
  it('is true for input/textarea/select and contentEditable, false otherwise', () => {
    const make = (tag: string): HTMLElement => document.createElement(tag);
    expect(isEditableTarget(make('input'))).toBe(true);
    expect(isEditableTarget(make('textarea'))).toBe(true);
    expect(isEditableTarget(make('select'))).toBe(true);
    expect(isEditableTarget(make('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    const ce = make('div');
    ce.contentEditable = 'true';
    // jsdom doesn't reflect isContentEditable from the attribute, so assert via
    // a spy'd getter to exercise the branch deterministically.
    Object.defineProperty(ce, 'isContentEditable', { value: true });
    expect(isEditableTarget(ce)).toBe(true);
  });
});

describe('preview', () => {
  it('collapses whitespace and falls back to (empty)', () => {
    expect(preview('  hello   world ')).toBe('hello world');
    expect(preview('   ')).toBe('(empty)');
    expect(preview('')).toBe('(empty)');
  });
});

describe('labelOf', () => {
  it('prefers the label, falling back to the id', () => {
    expect(labelOf(node('a', { label: 'Step A' } as Partial<BuilderNode>))).toBe('Step A');
    expect(labelOf(node('a'))).toBe('a');
  });
});

describe('topoOrder / topologySignature (re-tested at the source module)', () => {
  it('numbers a linear chain 1..N in dependency order', () => {
    const nodes = [node('a'), node('b', { needs: ['a'] }), node('c', { needs: ['b'] })];
    const order = topoOrder(nodes);
    expect([order.get('a'), order.get('b'), order.get('c')]).toEqual([1, 2, 3]);
  });

  it('signature is stable across a position-only move', () => {
    const before = [node('a'), node('b', { needs: ['a'] })];
    const moved = [node('a', { x: 37 }), node('b', { needs: ['a'], x: 240 })];
    expect(topologySignature(moved)).toBe(topologySignature(before));
  });
});
