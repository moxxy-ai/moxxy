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
