import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStepFlow, type FlowStep } from './step-flow.js';

/**
 * useStepFlow's linear-cursor stability when the active step set reshapes
 * mid-walk. The cursor is a position into the FILTERED list, so a step whose
 * `applies` flips true (e.g. a late async probe) must not bounce the user onto
 * a different step that now sits at the same index. Ordinary next/back (which
 * does not reshape the set) must still advance/retreat normally.
 */

interface Ctx {
  nodeApplies: boolean;
}

const STEPS: ReadonlyArray<FlowStep<Ctx>> = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'node', label: 'Install Node', applies: (c) => c.nodeApplies },
  { id: 'cli', label: 'Install CLI' },
  { id: 'provider', label: 'Pick a provider' },
];

describe('useStepFlow — linear cursor stability', () => {
  it('keeps the user on the same step when a late-applying step is inserted ahead of the cursor', () => {
    const onComplete = vi.fn();
    const { result, rerender } = renderHook(
      ({ ctx }) => useStepFlow(STEPS, ctx, { mode: 'linear', onComplete }),
      { initialProps: { ctx: { nodeApplies: false } as Ctx } },
    );

    // Walk welcome -> cli (node not yet applicable, so list is [welcome,cli,provider]).
    expect(result.current.currentId).toBe('welcome');
    act(() => result.current.next());
    expect(result.current.currentId).toBe('cli');

    // The node probe resolves: node now applies. Without the id-pin this would
    // reshape the list to [welcome,node,cli,provider] and the cursor (1) would
    // now point at 'node', bouncing the user backward.
    rerender({ ctx: { nodeApplies: true } });
    expect(result.current.currentId).toBe('cli');
    expect(result.current.steps.map((s) => s.id)).toEqual([
      'welcome',
      'node',
      'cli',
      'provider',
    ]);
  });

  it('still advances and retreats normally when the set is unchanged', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useStepFlow(STEPS, { nodeApplies: true }, { mode: 'linear', onComplete }),
    );
    expect(result.current.currentId).toBe('welcome');
    act(() => result.current.next());
    expect(result.current.currentId).toBe('node');
    act(() => result.current.next());
    expect(result.current.currentId).toBe('cli');
    act(() => result.current.back());
    expect(result.current.currentId).toBe('node');
  });

  it('completes by firing onComplete when the cursor advances past the last step', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useStepFlow([{ id: 'only', label: 'Only' }], {} as Ctx, { mode: 'linear', onComplete }),
    );
    expect(result.current.currentId).toBe('only');
    act(() => result.current.next());
    expect(result.current.isComplete).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
