import { describe, expect, it, vi } from 'vitest';
import {
  asEventId,
  asSessionId,
  asTurnId,
  estimateContextTokens,
  isContextOverflowError,
  runCompactionIfNeeded,
  runElisionIfNeeded,
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
