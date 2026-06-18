import { describe, expect, it } from 'vitest';
import type { Workflow } from '@moxxy/sdk';
import type { SerializedStepState } from '../run-store.js';
import type { ExecutorContext, StepState } from './context.js';
import {
  buildRunResult,
  buildStepResults,
  restoreStates,
  serializeStates,
} from './state-serde.js';

function st(over: Partial<StepState>): StepState {
  return { status: 'completed', output: '', startedAt: 0, endedAt: 0, ...over };
}

describe('state-serde', () => {
  it('serialize→restore is a faithful round-trip for settled states', () => {
    const states = new Map<string, StepState>([
      ['a', st({ status: 'completed', output: 'hi', startedAt: 1, endedAt: 2 })],
      ['b', st({ status: 'failed', output: '', error: 'boom', startedAt: 3, endedAt: 4 })],
      ['c', st({ status: 'skipped', output: '', startedAt: 5, endedAt: 6 })],
    ]);

    const serialized = serializeStates(states);
    const restored = restoreStates(serialized);

    expect([...restored.entries()]).toEqual([...states.entries()]);
  });

  it('serialize maps pending → "pending" and omits absent error', () => {
    const states = new Map<string, StepState>([
      ['p', st({ status: 'pending', output: '', startedAt: 0, endedAt: 0 })],
    ]);
    const out = serializeStates(states);
    expect(out.p.status).toBe('pending');
    expect('error' in out.p).toBe(false);
  });

  it('restore preserves an explicit error and drops it when absent', () => {
    const raw: Record<string, SerializedStepState> = {
      ok: { status: 'completed', output: 'x', startedAt: 0, endedAt: 1 },
      bad: { status: 'failed', output: '', error: 'nope', startedAt: 0, endedAt: 1 },
    };
    const restored = restoreStates(raw);
    expect('error' in restored.get('ok')!).toBe(false);
    expect(restored.get('bad')!.error).toBe('nope');
  });

  it('buildStepResults maps pending → "skipped" and reports per-step status', () => {
    const workflow = {
      steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    } as unknown as Workflow;
    const states = new Map<string, StepState>([
      ['a', st({ status: 'completed', output: 'o', startedAt: 1, endedAt: 2 })],
      ['b', st({ status: 'pending', output: '', startedAt: 0, endedAt: 0 })],
      ['c', st({ status: 'failed', output: '', error: 'e', startedAt: 3, endedAt: 4 })],
    ]);

    const results = buildStepResults(workflow, states);
    expect(results.map((r) => [r.id, r.status])).toEqual([
      ['a', 'completed'],
      ['b', 'skipped'],
      ['c', 'failed'],
    ]);
    expect(results[2].error).toBe('e');
  });

  it('buildRunResult only computes sink output when completed', () => {
    // single terminal (sink) step "a" with output; "b" depends on it.
    const workflow = {
      steps: [
        { id: 'a', needs: [] },
        { id: 'b', needs: ['a'] },
      ],
    } as unknown as Workflow;
    const states = new Map<string, StepState>([
      ['a', st({ status: 'completed', output: 'A' })],
      ['b', st({ status: 'completed', output: 'B' })],
    ]);
    const ctx = { workflow, states } as unknown as ExecutorContext;

    const completed = buildRunResult(ctx, 'completed', true);
    expect(completed.output).toBe('B'); // b is the only sink
    expect(completed.status).toBe('completed');
    expect(completed.ok).toBe(true);

    const failed = buildRunResult(ctx, 'failed', false, { error: 'x' });
    expect(failed.output).toBe(''); // non-completed → empty
    expect(failed.error).toBe('x');
  });
});
