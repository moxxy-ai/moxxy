import { describe, expect, it } from 'vitest';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { createWorkerIsolator } from './index.js';

const fixtureUrl = new URL('./__fixtures__/echo-handler.mjs', import.meta.url).href;

const call = (over: Partial<IsolatedToolCall> = {}): IsolatedToolCall => ({
  toolName: 'echo',
  input: { foo: 'bar' },
  callId: 'c1',
  sessionId: 's1',
  turnId: 't1',
  cwd: '/work',
  moduleRef: { url: fixtureUrl, export: 'echoHandler' },
  ...over,
});

describe('workerIsolator', () => {
  it('spawns a worker and round-trips the result', async () => {
    const iso = createWorkerIsolator();
    const out = await iso.run(
      call(),
      async () => 'unused',
      { timeMs: 5000 },
      new AbortController().signal,
    );
    expect(out).toEqual({ input: { foo: 'bar' }, sessionId: 's1', cwd: '/work' });
  });

  it('denies when moduleRef is missing', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call({ moduleRef: undefined }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no handlerModule declared/);
  });

  it('denies when caps fail on input', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call({ input: { file_path: '/etc/passwd' } }),
        async () => 'unused',
        { fs: { read: ['$cwd/**'] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared fs capability/);
  });

  it('terminates the worker on timeMs overrun', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call({
          moduleRef: { url: fixtureUrl, export: 'slowHandler' },
          input: { ms: 5000 },
        }),
        async () => 'unused',
        { timeMs: 100 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exceeded 100ms budget/);
  });

  it('terminates the worker on external abort', async () => {
    const iso = createWorkerIsolator();
    const ctrl = new AbortController();
    const promise = iso.run(
      call({
        moduleRef: { url: fixtureUrl, export: 'slowHandler' },
        input: { ms: 5000 },
      }),
      async () => 'unused',
      { timeMs: 10_000 },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 50);
    await expect(promise).rejects.toThrow(/aborted/);
  });

  it('rethrows handler exceptions in the parent', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call({ moduleRef: { url: fixtureUrl, export: 'throwHandler' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/intentional failure/);
  });

  // A malformed cap declaration must fail loudly rather than silently
  // disabling the headline memory / wall-clock guarantees.
  it('rejects a non-finite timeMs cap instead of collapsing the timer', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call(),
        async () => 'unused',
        { timeMs: Number.NaN },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/non-finite cap/);
  });

  it('rejects a non-finite memMb cap instead of building an invalid worker', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call(),
        async () => 'unused',
        { memMb: Number.POSITIVE_INFINITY },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/non-finite cap/);
  });

  // A negative / zero / fractional cap is clamped to a floor rather than
  // throwing an opaque V8 error or silently meaning "unlimited"; the
  // happy path must still complete.
  it('clamps an out-of-range memMb to the 16MB floor and still runs', async () => {
    const iso = createWorkerIsolator();
    const out = await iso.run(
      call(),
      async () => 'unused',
      { memMb: 0, timeMs: 5000 },
      new AbortController().signal,
    );
    expect(out).toEqual({ input: { foo: 'bar' }, sessionId: 's1', cwd: '/work' });
  });

  // A worker that exits cleanly (code 0) without ever posting a terminal
  // `result` is a protocol violation; the parent must reject promptly
  // instead of stalling the caller until the wall-clock budget fires.
  it('rejects fast when the worker exits without producing a result', async () => {
    const iso = createWorkerIsolator();
    const started = Date.now();
    await expect(
      iso.run(
        call({ moduleRef: { url: fixtureUrl, export: 'cleanExitHandler' }, input: {} }),
        async () => 'unused',
        { timeMs: 10_000 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exited .* before producing a result/);
    // Must not have waited out the 10s budget.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  // A handler that returns a value the structured-clone serializer
  // rejects (a function) must NOT stall to the budget or crash the
  // worker: the in-worker shim's postMessage throws a synchronous
  // DataCloneError, the shim catches it and re-posts a clean error
  // `result`, and the parent rejects fast with that error.
  it('rejects fast (no stall, no crash) when the handler returns a non-cloneable value', async () => {
    const iso = createWorkerIsolator();
    const started = Date.now();
    await expect(
      iso.run(
        call({ moduleRef: { url: fixtureUrl, export: 'nonCloneableHandler' }, input: {} }),
        async () => 'unused',
        { timeMs: 10_000 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/could not be cloned|DataClone/i);
    // Must not have waited out the budget — this is a fast failure.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  // A worker that posts an unrecognized message type (a future/forward-
  // compat or malformed message that is neither 'broker-request' nor a
  // well-formed 'result') must be IGNORED by the parent, not coerced
  // into a spurious `new Error(undefined)` rejection. The subsequent
  // terminal `result` must still settle the call normally.
  it('ignores stray/unknown worker message types and still settles on the result', async () => {
    const iso = createWorkerIsolator();
    const out = await iso.run(
      call({
        moduleRef: { url: fixtureUrl, export: 'strayMessageThenResolveHandler' },
        input: { marker: 42 },
      }),
      async () => 'unused',
      { timeMs: 5000 },
      new AbortController().signal,
    );
    expect(out).toEqual({ ok: true, echoed: { marker: 42 } });
  });

  // The boundary test. We set a global in the main thread, then ask
  // the worker to read it. The worker must NOT see it — that's the
  // entire justification for the 'worker' strength claim. If this
  // ever passes (sees the value), the isolator is lying.
  it('does NOT leak main-thread globals into the worker', async () => {
    (globalThis as Record<string, unknown>)['__MOXXY_TEST_FLAG__'] = 'visible-in-parent';
    const iso = createWorkerIsolator();
    const out = await iso.run(
      call({ moduleRef: { url: fixtureUrl, export: 'readGlobalHandler' }, input: {} }),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ seen: null });
    delete (globalThis as Record<string, unknown>)['__MOXXY_TEST_FLAG__'];
  });
});
