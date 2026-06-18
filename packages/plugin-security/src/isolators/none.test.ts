import { describe, expect, it } from 'vitest';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { noneIsolator } from './none.js';

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

describe('noneIsolator', () => {
  it('identifies as the zero-enforcement baseline', () => {
    expect(noneIsolator.name).toBe('none');
    expect(noneIsolator.strength).toBe('none');
  });

  it('runs the handler with the call input verbatim', async () => {
    const out = await noneIsolator.run(
      call({ ok: true }),
      async (i) => ({ echoed: i }),
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ echoed: { ok: true } });
  });

  it('does NOT enforce caps — a cap-violating input still runs (passthrough)', async () => {
    // The same input inprocIsolator rejects (outside fs cap) must run here,
    // proving the passthrough semantics are intentional and stable.
    const sentinel = { ran: true };
    const out = await noneIsolator.run(
      call({ file: '/etc/passwd' }),
      async () => sentinel,
      { fs: { read: ['$cwd/**'] } },
      new AbortController().signal,
    );
    expect(out).toBe(sentinel);
  });

  it('ignores the abort signal (no time budget enforcement)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await noneIsolator.run(
      call({}),
      async () => 'ok',
      {},
      ctrl.signal,
    );
    expect(out).toBe('ok');
  });
});
