import { describe, expect, it, vi } from 'vitest';
import {
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  computeElisionState,
  estimateContextTokens,
  isContextOverflowError,
  resolveModelContext,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  runManualCompaction,
  type CompactorDef,
  type EmittedEvent,
  type EventLogReader,
  type LLMProvider,
  type ModeContext,
  type MoxxyEvent,
  type MoxxyEventOfType,
  type MoxxyEventType,
  type TurnId,
} from './index.js';

const sid = asSessionId('s1');
const tid = asTurnId('t1');

describe('estimateContextTokens', () => {
  it('counts char/4 over events, honoring compaction', () => {
    const log = reader([
      event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'x'.repeat(400) }),
      event(1, {
        type: 'compaction',
        turnId: tid,
        source: 'compactor',
        compactor: 'summarize',
        replacedRange: [0, 0],
        summary: 'y'.repeat(40),
        tokensSaved: 90,
      }),
    ]);
    // 400-char user_prompt is covered by the compaction; only the 40-char
    // summary should count.
    expect(estimateContextTokens(log)).toBe(10);
  });

  it('u122-6: a wide compaction range counts as the summary, with later events full', () => {
    // The covered range spans many seqs but only one event actually exists at
    // seq 0; an event at seq 1000 (outside the range) must still count full.
    // This locks the interval-check rewrite against the old per-seq Set.
    const log = reader([
      event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'x'.repeat(400) }),
      event(1, {
        type: 'compaction',
        turnId: tid,
        source: 'compactor',
        compactor: 'summarize',
        replacedRange: [0, 999],
        summary: 'y'.repeat(40),
        tokensSaved: 90,
      }),
      event(1000, { type: 'assistant_message', turnId: tid, source: 'model', content: 'z'.repeat(80), stopReason: 'end_turn' }),
    ]);
    // 40-char summary + 80-char message = 120 chars → ceil(120/4) = 30.
    expect(estimateContextTokens(log)).toBe(30);
  });

  it('measures a ToolDisplayResult by its short forModel, not the bulky display', () => {
    // A recent (not-yet-elided) file-diff tool_result: the model only ever
    // sees the short `forModel` string, but a previous version of eventChars
    // JSON.stringified the whole `display` payload — wildly over-counting and
    // tripping compaction/elision thresholds prematurely. The estimate must
    // match what projection actually sends (forModel only).
    const forModel = 'Updated src/foo.ts (42 lines)'; // 29 chars
    // A large display payload: many diff lines whose stringified form dwarfs
    // forModel. If counted, the estimate would balloon.
    const lines = Array.from({ length: 200 }, (_, i) => ({
      kind: 'add' as const,
      text: 'x'.repeat(80),
      newNo: i + 1,
    }));
    const output = {
      forModel,
      display: {
        kind: 'file-diff' as const,
        path: 'src/foo.ts',
        mode: 'update' as const,
        added: 200,
        removed: 0,
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 200, lines }],
      },
    };
    const log = reader([
      event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'hi' }),
      event(1, {
        type: 'tool_call_requested',
        turnId: tid,
        source: 'model',
        callId: asToolCallId('c1'),
        name: 'Edit',
        input: {},
      }),
      event(2, {
        type: 'tool_result',
        turnId: tid,
        source: 'tool',
        callId: asToolCallId('c1'),
        ok: true,
        output,
      }),
    ]);
    // forModel is 29 chars; the bulky display (>16 KB stringified) must NOT be
    // counted. Estimate must stay within a couple tokens of forModel.length/4,
    // never the thousands of tokens the stringified display would imply.
    const tokens = estimateContextTokens(log);
    expect(tokens).toBeLessThan(50);
  });

  it('an explicitly-passed elision state yields the byte-identical estimate', () => {
    // The optional precomputed-state fast path must equal recomputation. Build a
    // log with elision + a recall so the state is non-trivial.
    const events: MoxxyEvent[] = [
      event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'the task' }),
      event(1, { type: 'tool_call_requested', turnId: tid, source: 'model', callId: asToolCallId('c1'), name: 'Read', input: { file_path: '/a' } }),
      event(2, { type: 'tool_result', turnId: tid, source: 'tool', callId: asToolCallId('c1'), ok: true, output: 'Z'.repeat(5000) }),
      event(3, { type: 'assistant_message', turnId: tid, source: 'model', content: 'answer '.repeat(50), stopReason: 'end_turn' }),
      event(4, {
        type: 'elision', turnId: asTurnId('t2'), source: 'system', elidedThrough: 3, stubbedRanges: [[0, 3]],
        elideConversational: true, conversationalRecallThreshold: 4, maxRecallBytes: 32_768, neverElideTools: [], tokensSaved: 1200,
      }),
      event(5, { type: 'user_prompt', turnId: asTurnId('t2'), source: 'user', text: 'next' }),
    ];
    const log = reader(events);
    const recomputed = estimateContextTokens(log);
    const withState = estimateContextTokens(log, computeElisionState(events));
    expect(withState).toBe(recomputed);
  });
});

describe('runCompactionIfNeeded', () => {
  it('is a no-op when no compactor is active', async () => {
    const ctx = makeCtx({ compactor: null });
    await runCompactionIfNeeded(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });

  it('is a no-op when shouldCompact returns false', async () => {
    const shouldCompact = vi.fn().mockReturnValue(false);
    const compact = vi.fn();
    const ctx = makeCtx({
      compactor: { name: 'fake', shouldCompact, compact },
    });
    await runCompactionIfNeeded(ctx);
    expect(shouldCompact).toHaveBeenCalledOnce();
    expect(compact).not.toHaveBeenCalled();
    expect(ctx.emitted).toHaveLength(0);
  });

  it('passes the real model contextWindow into the budget', async () => {
    let observedWindow = 0;
    const compactor: CompactorDef = {
      name: 'inspect',
      shouldCompact: (_log, budget) => {
        observedWindow = budget.contextWindow;
        return false;
      },
      compact: async () => {
        throw new Error('should not run');
      },
    };
    const ctx = makeCtx({ compactor, model: 'm-200k', contextWindow: 200_000 });
    await runCompactionIfNeeded(ctx);
    expect(observedWindow).toBe(200_000);
  });

  it('emits the compaction event when shouldCompact returns true', async () => {
    const compactor: CompactorDef = {
      name: 'fake',
      shouldCompact: () => true,
      compact: async () => ({
        type: 'compaction',
        sessionId: sid,
        turnId: tid,
        source: 'compactor',
        compactor: 'fake',
        replacedRange: [0, 0],
        summary: 'compressed',
        tokensSaved: 100,
      }),
    };
    const ctx = makeCtx({ compactor });
    await runCompactionIfNeeded(ctx);
    expect(ctx.emitted).toHaveLength(1);
    expect(ctx.emitted[0]).toMatchObject({ type: 'compaction', summary: 'compressed' });
  });

  it('skips the emit when compact returns an empty/no-op result', async () => {
    const compactor: CompactorDef = {
      name: 'fake',
      shouldCompact: () => true,
      compact: async () => ({
        type: 'compaction',
        sessionId: sid,
        turnId: tid,
        source: 'compactor',
        compactor: 'fake',
        replacedRange: [0, 0],
        summary: '',
        tokensSaved: 0,
      }),
    };
    const ctx = makeCtx({ compactor });
    await runCompactionIfNeeded(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });

  it('emits a non-fatal error event when compact throws — turn must continue', async () => {
    const compactor: CompactorDef = {
      name: 'broken',
      shouldCompact: () => true,
      compact: async () => {
        throw new Error('boom');
      },
    };
    const ctx = makeCtx({ compactor });
    await runCompactionIfNeeded(ctx);
    expect(ctx.emitted).toHaveLength(1);
    expect(ctx.emitted[0]).toMatchObject({ type: 'error', kind: 'retryable' });
  });

  it('still resolves a context window for a model id not in the descriptor list', async () => {
    // Regression: an unlisted model id (e.g. a newer release the provider's
    // fixed descriptor list doesn't enumerate) used to make shouldCompact never
    // run, silently disabling auto-compaction for the whole session.
    let observedWindow = -1;
    const compactor: CompactorDef = {
      name: 'inspect',
      shouldCompact: (_log, budget) => {
        observedWindow = budget.contextWindow;
        return false;
      },
      compact: async () => {
        throw new Error('should not run');
      },
    };
    const ctx = makeCtx({
      compactor,
      model: 'claude-opus-4-7', // the listed descriptor
      contextWindow: 800_000,
      ctxModelId: 'claude-opus-4-8', // …but the session runs an unlisted id
    });
    await runCompactionIfNeeded(ctx);
    // Falls back to models[0].contextWindow instead of bailing.
    expect(observedWindow).toBe(800_000);
  });

  it('force-compacts even when the provider exposes no usable context window', async () => {
    // Reactive overflow recovery: the provider already said the prompt is too
    // big, so a missing/zero window must NOT block the forced compaction.
    const compact = vi.fn(async () => ({
      type: 'compaction' as const,
      replacedRange: [0, 1] as [number, number],
      summary: 'summary',
      tokensSaved: 500,
    }));
    const compactor: CompactorDef = { name: 'gated', shouldCompact: () => false, compact };
    const ctx = makeCtx({ compactor, emptyModels: true });
    const did = await runCompactionIfNeeded(ctx, { force: true });
    expect(did).toBe(true);
    expect(compact).toHaveBeenCalledOnce();
  });

  it('is a no-op (non-force) when the provider exposes no usable context window', async () => {
    const compact = vi.fn();
    const shouldCompact = vi.fn().mockReturnValue(true);
    const ctx = makeCtx({ compactor: { name: 'x', shouldCompact, compact }, emptyModels: true });
    const did = await runCompactionIfNeeded(ctx);
    expect(did).toBe(false);
    expect(shouldCompact).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
  });

  it('force compacts even when shouldCompact returns false', async () => {
    const compact = vi.fn(async () => ({
      type: 'compaction' as const,
      replacedRange: [0, 1] as [number, number],
      summary: 'summary',
      tokensSaved: 500,
    }));
    const compactor: CompactorDef = {
      name: 'gated',
      shouldCompact: () => false, // gate says no…
      compact,
    };
    const ctx = makeCtx({ compactor });
    const did = await runCompactionIfNeeded(ctx, { force: true }); // …but force overrides
    expect(did).toBe(true);
    expect(compact).toHaveBeenCalledOnce();
    expect(ctx.emitted.some((e) => e.type === 'compaction')).toBe(true);
  });
});

describe('runManualCompaction', () => {
  // An appendable reader matching ManualCompactionInput.log — records the
  // appended event so we can assert defensive identity-fill.
  function appendableLog(seed: ReadonlyArray<MoxxyEvent>): EventLogReader & {
    append(event: EmittedEvent): Promise<MoxxyEvent>;
    appended: EmittedEvent[];
  } {
    const events = [...seed];
    const appended: EmittedEvent[] = [];
    return {
      ...reader(events),
      appended,
      append: async (e: EmittedEvent) => {
        appended.push(e);
        const mat = { ...e, id: asEventId(`a${appended.length}`), seq: events.length, ts: events.length, sessionId: sid } as MoxxyEvent;
        events.push(mat);
        return mat;
      },
    };
  }

  const seed: MoxxyEvent[] = [
    event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'x'.repeat(400) }),
    event(1, { type: 'assistant_message', turnId: tid, source: 'model', content: 'y'.repeat(400), stopReason: 'end_turn' }),
  ];

  it('returns the no-op result for an empty log', async () => {
    const log = appendableLog([]);
    const compactor: CompactorDef = {
      name: 'never',
      shouldCompact: () => false,
      compact: async () => { throw new Error('should not run'); },
    };
    const res = await runManualCompaction({ compactor, log });
    expect(res).toEqual({ compacted: false, tokensSaved: 0, eventsCompacted: 0 });
    expect(log.appended).toHaveLength(0);
  });

  it('compacts unconditionally (no shouldCompact gate) and reports counts', async () => {
    const log = appendableLog(seed);
    const shouldCompact = vi.fn().mockReturnValue(false); // would block the auto path
    const compactor: CompactorDef = {
      name: 'fake',
      shouldCompact,
      compact: async () => ({
        type: 'compaction',
        compactor: 'fake',
        replacedRange: [0, 1],
        summary: 'compressed',
        tokensSaved: 123,
      }),
    };
    const res = await runManualCompaction({ compactor, log });
    // shouldCompact is NEVER consulted — manual compaction always runs.
    expect(shouldCompact).not.toHaveBeenCalled();
    expect(res).toEqual({ compacted: true, tokensSaved: 123, eventsCompacted: 2 });
    expect(log.appended).toHaveLength(1);
    // Defensive identity fill from the log tail + source=compactor.
    expect(log.appended[0]).toMatchObject({ type: 'compaction', source: 'compactor', sessionId: sid, turnId: tid });
  });

  it('counts only events inside the inclusive replacedRange, not the seq span', async () => {
    // A range [0, 999] spanning a gap: only the two real events fall inside.
    const log = appendableLog([
      event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'x'.repeat(400) }),
      event(500, { type: 'assistant_message', turnId: tid, source: 'model', content: 'z'.repeat(400), stopReason: 'end_turn' }),
    ]);
    const compactor: CompactorDef = {
      name: 'wide',
      shouldCompact: () => false,
      compact: async () => ({
        type: 'compaction', compactor: 'wide', replacedRange: [0, 999], summary: 's', tokensSaved: 50,
      }),
    };
    const res = await runManualCompaction({ compactor, log });
    expect(res.eventsCompacted).toBe(2);
  });

  it('reports no-op (no append) when the summary is empty / tokensSaved <= 0', async () => {
    const log = appendableLog(seed);
    const compactor: CompactorDef = {
      name: 'empty',
      shouldCompact: () => true,
      compact: async () => ({
        type: 'compaction', compactor: 'empty', replacedRange: [0, 1], summary: '   ', tokensSaved: 0,
      }),
    };
    const res = await runManualCompaction({ compactor, log });
    expect(res.compacted).toBe(false);
    expect(log.appended).toHaveLength(0);
  });

  it('caller-supplied sessionId/turnId override the log-tail fallback', async () => {
    const log = appendableLog(seed);
    const compactor: CompactorDef = {
      name: 'fake', shouldCompact: () => false,
      compact: async () => ({ type: 'compaction', compactor: 'fake', replacedRange: [0, 1], summary: 'ok', tokensSaved: 10 }),
    };
    await runManualCompaction({
      compactor, log, sessionId: asSessionId('other'), turnId: asTurnId('explicit'),
    });
    expect(log.appended[0]).toMatchObject({ sessionId: 'other', turnId: 'explicit' });
  });
});

describe('isContextOverflowError', () => {
  it('matches common provider context-overflow phrasings', () => {
    for (const msg of [
      'input exceeds context window',
      "This model's maximum context length is 200000 tokens",
      'context_length_exceeded',
      'prompt is too long: 250000 tokens > 200000 maximum',
      'Please reduce the length of the messages',
      'too many input tokens',
    ]) {
      expect(isContextOverflowError(msg)).toBe(true);
    }
  });

  it('does not match unrelated errors', () => {
    for (const msg of ['rate limit exceeded', 'network timeout', '500 internal server error', 'invalid api key']) {
      expect(isContextOverflowError(msg)).toBe(false);
    }
  });
});

describe('resolveModelContext', () => {
  it('warns once on the models[0] fallback for an unlisted id, keeping the fallback window', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // ctx.model is an id the provider's catalog does not enumerate; the sole
      // descriptor is 'listed-a'. Use a unique tuple so the module-level dedupe
      // Set (shared across this file) isn't primed by another test.
      const ctx = makeCtx({
        compactor: null,
        model: 'listed-a',
        contextWindow: 321_000,
        ctxModelId: 'unlisted-variant-1m',
      });
      const first = resolveModelContext(ctx);
      const second = resolveModelContext(ctx);
      // Return value is the models[0] fallback — the diagnostic changes nothing.
      expect(first).toEqual({ contextWindow: 321_000, reserveForOutput: 0 });
      expect(second).toEqual(first);
      // Deduped on (provider, requested id, fallback id): one warn, not per call.
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0]?.[0]);
      expect(msg).toContain('unlisted-variant-1m');
      expect(msg).toContain('listed-a');
      expect(msg).toContain('321000');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when ctx.model matches a descriptor exactly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = makeCtx({ compactor: null, model: 'exact-match-model', contextWindow: 128_000 });
      const resolved = resolveModelContext(ctx);
      expect(resolved).toEqual({ contextWindow: 128_000, reserveForOutput: 0 });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runElisionIfNeeded', () => {
  // Six completed turns of bulky prompts, none matching ctx.turnId (so all are
  // "completed"). With keepRecentTurns=4 the two oldest turns are elidable.
  const bulkyTurns: MoxxyEvent[] = Array.from({ length: 6 }, (_, i) =>
    event(i, {
      type: 'user_prompt',
      turnId: asTurnId(`turn-${i}`),
      source: 'user',
      text: 'x'.repeat(400),
    }),
  );

  it('elides old turns for a model id not in the descriptor list', async () => {
    // Regression: an unlisted model id used to disable elision entirely, so the
    // context grew unbounded and the agent lost its earlier context. With the
    // models[0] fallback the elision high-water mark advances as expected.
    const ctx = makeCtx({
      compactor: null,
      events: bulkyTurns,
      model: 'listed-model',
      ctxModelId: 'unlisted-model-xyz',
      contextWindow: 1_000, // estimate (~600 tok) is well over 0.3 * window (300)
    });
    await runElisionIfNeeded(ctx);
    expect(ctx.emitted.some((e) => e.type === 'elision')).toBe(true);
  });

  it('is a no-op when the provider exposes no usable context window', async () => {
    const ctx = makeCtx({ compactor: null, events: bulkyTurns, emptyModels: true });
    await runElisionIfNeeded(ctx);
    expect(ctx.emitted).toHaveLength(0);
  });
});

interface MakeCtxOpts {
  readonly compactor: CompactorDef | null;
  readonly model?: string;
  readonly contextWindow?: number;
  readonly events?: ReadonlyArray<MoxxyEvent>;
  /** Set ctx.model to an id the provider's descriptor list does NOT contain,
   *  so `models.find(...)` misses and the models[0] fallback must kick in. */
  readonly ctxModelId?: string;
  /** Give the provider an empty descriptor list (no usable context window). */
  readonly emptyModels?: boolean;
}

function makeCtx(opts: MakeCtxOpts): ModeContext & { emitted: EmittedEvent[] } {
  const events = opts.events ?? [
    event(0, { type: 'user_prompt', turnId: tid, source: 'user', text: 'hi' }),
  ];
  const log = reader(events);
  const provider = {
    name: 'fake',
    models: opts.emptyModels
      ? []
      : [
          {
            id: opts.model ?? 'fake-model',
            contextWindow: opts.contextWindow ?? 100_000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
    stream: async function* () { /* unused */ },
    countTokens: async () => 0,
  } as unknown as LLMProvider;

  const emitted: EmittedEvent[] = [];
  const ctx = {
    sessionId: sid,
    turnId: tid,
    // ctx.model may intentionally differ from the descriptor id to exercise the
    // unlisted-model fallback.
    model: opts.ctxModelId ?? opts.model ?? 'fake-model',
    provider,
    tools: { list: () => [], get: () => undefined, execute: async () => undefined },
    skills: { list: () => [], get: () => undefined, byName: () => undefined, filterByTriggers: () => [] },
    log,
    compactor: opts.compactor,
    permissions: { decide: async () => ({ allow: true }) },
    hooks: {} as ModeContext['hooks'],
    pluginHost: { list: () => [], reload: async () => {} },
    signal: new AbortController().signal,
    emit: async (e: EmittedEvent) => {
      emitted.push(e);
      return { ...e, id: asEventId(`e${emitted.length}`), seq: emitted.length, ts: emitted.length, sessionId: sid } as MoxxyEvent;
    },
  } as unknown as ModeContext;

  return Object.assign(ctx, { emitted });
}

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> =>
      events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

function event(
  seq: number,
  partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>,
): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    ...partial,
  } as MoxxyEvent;
}
