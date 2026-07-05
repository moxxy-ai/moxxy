import { describe, expect, it } from 'vitest';
import { asSessionId, asTurnId } from './ids.js';
import type { EmittedEvent, MoxxyEvent } from './events.js';
import type { ModeContext } from './mode.js';
import type { CollectedToolUse, StuckLoopDetector, StuckSignal } from './mode-helpers.js';
import type { ToolCallVerdict } from './hooks.js';
import type { PermissionDecision } from './permission.js';
import {
  dispatchToolCall,
  executeToolUses,
  emitRequestsAndDetectStuck,
  emitRequestsAndNudgeOnStuck,
  type StuckLoopReport,
  type StuckNudgeReport,
  type StuckTripInfo,
} from './tool-dispatch.js';

/**
 * The orphan-prevention guarantees in tool-dispatch are load-bearing: the event
 * log must never end on a `tool_call_requested` without a paired `tool_result`,
 * across hook throws, resolver throws, emit throws, mid-batch abort, and a
 * stuck-loop trip. These tests drive each defensive path directly (the mode
 * tests only exercise the happy path).
 */

interface StubOpts {
  readonly verdict?: ToolCallVerdict | (() => ToolCallVerdict | Promise<ToolCallVerdict>);
  readonly decision?: PermissionDecision;
  readonly execute?: (name: string, input: unknown) => unknown;
  /** Throw from `emit` for these 0-based emit indices. */
  readonly throwOnEmitIndices?: ReadonlyArray<number>;
  readonly aborted?: boolean;
}

function makeCtx(opts: StubOpts = {}): { ctx: ModeContext; events: MoxxyEvent[] } {
  const events: MoxxyEvent[] = [];
  let emitCount = 0;
  const controller = new AbortController();
  if (opts.aborted) controller.abort();

  const emit = async (event: EmittedEvent): Promise<MoxxyEvent> => {
    const idx = emitCount++;
    if (opts.throwOnEmitIndices?.includes(idx)) {
      throw new Error('emit boom');
    }
    const full = { ...event, id: `e${idx}`, ts: idx } as unknown as MoxxyEvent;
    events.push(full);
    return full;
  };

  const ctx = {
    sessionId: asSessionId('s1'),
    turnId: asTurnId('t1'),
    cwd: '/tmp',
    env: {},
    log: { events: () => [], subscribe: () => () => {} } as unknown,
    signal: controller.signal,
    hooks: {
      dispatchToolCall: async (): Promise<ToolCallVerdict> => {
        const v = opts.verdict ?? { action: 'allow' };
        return typeof v === 'function' ? v() : v;
      },
    } as unknown,
    permissions: {
      check: async (): Promise<PermissionDecision> => opts.decision ?? { mode: 'allow' },
    } as unknown,
    tools: {
      get: () => undefined,
      execute: async (name: string, input: unknown) =>
        opts.execute ? opts.execute(name, input) : 'ok',
    } as unknown,
    emit,
  } as unknown as ModeContext;

  return { ctx, events };
}

async function drain(
  gen: AsyncGenerator<MoxxyEvent, unknown, unknown>,
): Promise<unknown> {
  let res = await gen.next();
  while (!res.done) res = await gen.next();
  return res.value;
}

const tool: CollectedToolUse = { id: 'c1', name: 'Read', input: { x: 1 } };

describe('dispatchToolCall — orphan prevention', () => {
  it('happy path ends with a successful tool_result', async () => {
    const { ctx, events } = makeCtx({ execute: () => 'output' });
    await drain(dispatchToolCall(ctx, tool, 0));
    const result = events.find((e) => e.type === 'tool_result') as { ok: boolean } | undefined;
    expect(result?.ok).toBe(true);
  });

  it('synthesizes a failed result when the hook throws (no orphan)', async () => {
    const { ctx, events } = makeCtx({
      verdict: () => {
        throw new Error('hook exploded');
      },
    });
    await drain(dispatchToolCall(ctx, tool, 0));
    const result = events.find((e) => e.type === 'tool_result') as
      | { ok: boolean; error: { message: string } }
      | undefined;
    expect(result?.ok).toBe(false);
    expect(result?.error.message).toContain('pre-execute failure');
    expect(result?.error.message).toContain('hook exploded');
  });

  it('synthesizes a failed result when the resolver throws', async () => {
    const { ctx, events } = makeCtx({
      decision: undefined,
    });
    // Make permissions.check itself throw via a hostile override.
    (ctx.permissions as unknown as { check: () => Promise<never> }).check = async () => {
      throw new Error('resolver down');
    };
    await drain(dispatchToolCall(ctx, tool, 0));
    const result = events.find((e) => e.type === 'tool_result') as
      | { ok: boolean; error: { message: string } }
      | undefined;
    expect(result?.ok).toBe(false);
    expect(result?.error.message).toContain('pre-execute failure');
  });

  it('labels a post-run emit failure as "tool ran but result emit failed"', async () => {
    // Emit order: #0 = tool_call_approved, #1 = success tool_result (throws →
    // inner catch), #2 = inner-catch failed tool_result (throws → outer catch).
    // The outer catch must NOT mislabel a tool that already ran as a
    // pre-execute failure.
    const { ctx, events } = makeCtx({
      execute: () => 'output',
      throwOnEmitIndices: [1, 2],
    });
    await drain(dispatchToolCall(ctx, tool, 0));
    const result = events.find((e) => e.type === 'tool_result') as
      | { ok: boolean; error: { message: string } }
      | undefined;
    expect(result?.ok).toBe(false);
    expect(result?.error.message).toContain('tool ran but result emit failed');
    expect(result?.error.message).not.toContain('pre-execute failure');
  });

  it('emits a denied result + tool_result when the hook denies', async () => {
    const { ctx, events } = makeCtx({ verdict: { action: 'deny', reason: 'nope' } });
    await drain(dispatchToolCall(ctx, tool, 0));
    expect(events.some((e) => e.type === 'tool_call_denied')).toBe(true);
    const result = events.find((e) => e.type === 'tool_result') as { ok: boolean } | undefined;
    expect(result?.ok).toBe(false);
  });
});

describe('executeToolUses — mid-batch abort', () => {
  it('synthesizes a tool_result for every un-run call and an abort when aborted up front', async () => {
    const { ctx, events } = makeCtx({ aborted: true });
    const calls: CollectedToolUse[] = [
      { id: 'a', name: 'Read', input: {} },
      { id: 'b', name: 'Read', input: {} },
    ];
    const stop = await drain(executeToolUses(ctx, calls, 0));
    expect(stop).toBe(true);
    const results = events.filter((e) => e.type === 'tool_result') as Array<{
      callId: string;
      error: { kind: string };
    }>;
    expect(new Set(results.map((r) => r.callId))).toEqual(new Set(['a', 'b']));
    expect(results.every((r) => r.error.kind === 'aborted')).toBe(true);
    expect(events.some((e) => e.type === 'abort')).toBe(true);
  });
});

describe('emitRequestsAndDetectStuck — stuck trip', () => {
  const report: StuckLoopReport = {
    abortedResultMessage: 'stuck — not run',
    nearHint: 'with nearly identical input',
    fatalMessage: ({ toolName }) => `stuck on ${toolName}`,
  };

  function detector(trip: StuckSignal): StuckLoopDetector {
    return { record: () => trip } as unknown as StuckLoopDetector;
  }

  it('synthesizes a failed tool_result for the emitted request before the fatal error', async () => {
    const { ctx, events } = makeCtx();
    const stop = await drain(
      emitRequestsAndDetectStuck(
        ctx,
        [tool],
        detector({ stuck: true, kind: 'exact', count: 3 }),
        report,
      ),
    );
    expect(stop).toBe(true);
    // The request must be paired with a synthesized aborted result — no orphan.
    expect(events.some((e) => e.type === 'tool_call_requested')).toBe(true);
    const result = events.find((e) => e.type === 'tool_result') as
      | { ok: boolean; error: { kind: string } }
      | undefined;
    expect(result?.ok).toBe(false);
    expect(result?.error.kind).toBe('aborted');
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('returns false (no synthesis) when the detector does not trip', async () => {
    const { ctx, events } = makeCtx();
    const stop = await drain(
      emitRequestsAndDetectStuck(
        ctx,
        [tool],
        detector({ stuck: false, kind: 'exact', count: 0 }),
        report,
      ),
    );
    expect(stop).toBe(false);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(0);
  });
});

describe('emitRequestsAndNudgeOnStuck — steer, never stop', () => {
  const nudgeReport: StuckNudgeReport = {
    nearHint: 'with nearly identical input',
    warnMessage: ({ toolName, count }) => `repetitive: ${toolName} x${count}`,
    extraOnStuck: ({ toolName }) => [
      {
        type: 'plugin_event',
        sessionId: asSessionId('s1'),
        turnId: asTurnId('t1'),
        source: 'plugin',
        pluginId: 'test' as never,
        subtype: 'test_stuck',
        payload: { toolName },
      },
    ],
  };

  function nudgeDetector(trip: StuckSignal): StuckLoopDetector & { resets: number } {
    const d = {
      resets: 0,
      record: () => trip,
      reset: () => {
        d.resets += 1;
      },
    };
    return d as unknown as StuckLoopDetector & { resets: number };
  }

  it('on a trip: warns (retryable, not fatal), emits extra events, resets the detector, and does NOT synthesize results', async () => {
    const { ctx, events } = makeCtx();
    const det = nudgeDetector({ stuck: true, kind: 'exact', count: 8 });
    const trip = (await drain(
      emitRequestsAndNudgeOnStuck(ctx, [tool], det, nudgeReport),
    )) as StuckTripInfo | null;

    // Trip info is returned for the loop's volatile nudge…
    expect(trip).toEqual({ toolName: 'Read', count: 8, kind: 'exact', how: 'with identical input' });
    // …the detector started a fresh episode…
    expect(det.resets).toBe(1);
    // …the request stands (the batch will execute — no synthesized results)…
    expect(events.some((e) => e.type === 'tool_call_requested')).toBe(true);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(0);
    // …the warning is visible but NON-fatal, with the extra event before it.
    const err = events.find((e) => e.type === 'error') as
      | { kind: string; message: string }
      | undefined;
    expect(err?.kind).toBe('retryable');
    expect(err?.message).toBe('repetitive: Read x8');
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'test_stuck')).toBe(true);
  });

  it('a near trip uses the report nearHint wording', async () => {
    const { ctx } = makeCtx();
    const trip = (await drain(
      emitRequestsAndNudgeOnStuck(
        ctx,
        [tool],
        nudgeDetector({ stuck: true, kind: 'near', count: 5 }),
        nudgeReport,
      ),
    )) as StuckTripInfo | null;
    expect(trip?.how).toBe('with nearly identical input');
  });

  it('returns null and stays quiet when the detector does not trip', async () => {
    const { ctx, events } = makeCtx();
    const det = nudgeDetector({ stuck: false, kind: 'exact', count: 0 });
    const trip = await drain(emitRequestsAndNudgeOnStuck(ctx, [tool], det, nudgeReport));
    expect(trip).toBeNull();
    expect(det.resets).toBe(0);
    expect(events.filter((e) => e.type !== 'tool_call_requested')).toHaveLength(0);
  });
});
