/**
 * Mobile workflow-builder logic test. The shared reducer/serializer are
 * exhaustively covered in @moxxy/workflows-builder; here we lock down the
 * mobile-specific glue: the edit-nav href and that the mobile editor's
 * operation sequence (add loop + body step, wire body/exit, configure) produces
 * the YAML the host's save expects — exercised purely (no RN render), per the
 * mobile test convention.
 */

import { describe, expect, it } from 'vitest';
import {
  addStep,
  builderReducer,
  emptyState,
  serialize,
  type BuilderState,
} from '@moxxy/workflows-builder';
import { workflowEditHref } from '../workflowEditNav';

function reduce(state: BuilderState, ...actions: Parameters<typeof builderReducer>[1][]): BuilderState {
  return actions.reduce(builderReducer, state);
}

describe('workflowEditHref', () => {
  it('builds a blank-builder href with no name', () => {
    expect(workflowEditHref(null)).toBe('/workflow-edit');
  });
  it('url-encodes the workflow name', () => {
    expect(workflowEditHref('daily summary')).toBe('/workflow-edit?name=daily%20summary');
  });
});

describe('mobile editor operation sequence → YAML', () => {
  it('produces a valid loop workflow shape the host can save', () => {
    let s = emptyState('refine-draft');
    s = builderReducer(s, { type: 'update-meta', patch: { description: 'Refine until good.' } });
    s = addStep(s, { kind: 'prompt', id: 'first_draft' });
    s = builderReducer(s, { type: 'update-node', id: 'first_draft', patch: { action: 'Write a first draft.' } });
    s = addStep(s, { kind: 'loop', id: 'refine', after: 'first_draft' });
    s = addStep(s, { kind: 'bridge', id: 'improve' });
    s = builderReducer(s, { type: 'update-node', id: 'improve', patch: { action: 'Improve. Return vars.draft.' } });
    s = addStep(s, { kind: 'prompt', id: 'finish' });
    s = builderReducer(s, { type: 'update-node', id: 'finish', patch: { action: 'Emit final.' } });

    s = reduce(
      s,
      { type: 'set-loop-body', loopId: 'refine', body: ['improve'] },
      { type: 'set-loop-exit', loopId: 'refine', targetId: 'finish' },
      { type: 'set-loop-config', loopId: 'refine', patch: { condition: 'Good enough?', maxIterations: 5 } },
    );

    const { workflow, yaml } = serialize(s);
    const loop = workflow.steps.find((st) => st.id === 'refine')!;
    expect(loop.loop).toEqual({ body: ['improve'], condition: 'Good enough?', maxIterations: 5 });
    // body + exit both scoped to the loop via needs
    expect(workflow.steps.find((st) => st.id === 'improve')!.needs).toContain('refine');
    expect(workflow.steps.find((st) => st.id === 'finish')!.needs).toContain('refine');
    // exactly one loop-exit edge in the rendered graph
    expect(s.edges.filter((e) => e.kind === 'loop-exit')).toHaveLength(1);
    expect(yaml).toContain('name: refine-draft');
    expect(yaml).toContain('maxIterations: 5');
  });
});
