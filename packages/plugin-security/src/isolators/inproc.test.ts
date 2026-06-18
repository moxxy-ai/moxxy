import { describe, expect, it } from 'vitest';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { inprocIsolator } from './inproc.js';

function call(input: unknown, cwd = '/work'): IsolatedToolCall {
  return {
    toolName: 'test',
    input,
    callId: 'c1',
    sessionId: 's1',
    turnId: 't1',
    cwd,
  };
}

describe('inprocIsolator', () => {
  it('runs the handler when caps validate', async () => {
    const out = await inprocIsolator.run(
      call({ ok: true }),
      async (i) => ({ echoed: i }),
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ echoed: { ok: true } });
  });

  it('rejects when fs cap is violated', async () => {
    await expect(
      inprocIsolator.run(
        call({ file: '/etc/passwd' }),
        async () => 'never',
        { fs: { read: ['$cwd/**'] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared fs capability/);
  });

  it('aborts when timeMs is exceeded', async () => {
    await expect(
      inprocIsolator.run(
        call({}),
        () => new Promise((r) => setTimeout(r, 200)),
        { timeMs: 30 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exceeded 30ms budget/);
  });

  it('propagates an external abort', async () => {
    const ctrl = new AbortController();
    const p = inprocIsolator.run(
      call({}),
      () => new Promise((r) => setTimeout(r, 300)),
      { timeMs: 1000 },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toThrow(/aborted/);
  });

  // u104-1 regression: on timeout the isolator must ABORT the handler-facing
  // signal, not merely reject its own promise while the handler runs on.
  it('aborts the handler-facing signal when timeMs is exceeded', async () => {
    let handlerSignal: AbortSignal | undefined;
    let observedAbort = false;
    const p = inprocIsolator.run(
      call({}),
      // Handler reads the signal the isolator threads in (second arg). It never
      // resolves on its own — only a propagated abort can unblock it.
      (_input, sig?: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) => {
          handlerSignal = sig;
          sig?.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('handler observed abort'));
          });
        }),
      { timeMs: 20 },
      new AbortController().signal,
    );
    await expect(p).rejects.toThrow(/exceeded 20ms budget/);
    // Give the abort event a microtask/tick to flush, then assert it fired.
    await new Promise((r) => setTimeout(r, 5));
    expect(handlerSignal).toBeInstanceOf(AbortSignal);
    expect(handlerSignal?.aborted).toBe(true);
    expect(observedAbort).toBe(true);
  });

  // u104-1 control: a fast handler still resolves normally (no spurious abort).
  it('does not abort a handler that finishes within budget', async () => {
    let aborted = false;
    const out = await inprocIsolator.run(
      call({}),
      (input, sig?: AbortSignal) => {
        sig?.addEventListener('abort', () => {
          aborted = true;
        });
        return Promise.resolve({ done: input });
      },
      { timeMs: 1000 },
      new AbortController().signal,
    );
    expect(out).toEqual({ done: {} });
    expect(aborted).toBe(false);
  });
});
