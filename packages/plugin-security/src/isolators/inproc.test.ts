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
});
