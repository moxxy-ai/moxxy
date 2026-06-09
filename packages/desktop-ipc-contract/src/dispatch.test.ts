import { describe, it, expect } from 'vitest';
import { dispatch, IpcError } from './dispatch.js';

describe('dispatch', () => {
  it('returns ok with the handler value', async () => {
    const r = await dispatch('connection.activeWorkspace', [], async () => 'ws-1');
    expect(r).toEqual({ ok: true, value: 'ws-1' });
  });

  it('normalizes an undefined result to null (so JSON-RPC round-trips it)', async () => {
    const r = await dispatch(
      'ask.respond',
      [{ requestId: 'r', response: {} }],
      async () => undefined,
    );
    expect(r).toEqual({ ok: true, value: null });
  });

  it('classifies a thrown IpcError by its code', async () => {
    const r = await dispatch('session.info', [{}], async () => {
      throw new IpcError('not-connected', 'nope');
    });
    expect(r).toEqual({ ok: false, error: { code: 'not-connected', message: 'nope' } });
  });

  it('classifies an arbitrary throw as runner-error', async () => {
    const r = await dispatch('session.info', [{}], async () => {
      throw new Error('boom');
    });
    expect(r).toEqual({ ok: false, error: { code: 'runner-error', message: 'boom' } });
  });

  it('rejects an invalid payload before the handler runs', async () => {
    let ran = false;
    const r = await dispatch('desks.create', [{ name: '', cwd: '' }], async () => {
      ran = true;
      return { id: 'x', name: '', cwd: '', color: '', createdAt: 0 };
    });
    expect(ran).toBe(false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-payload');
  });
});
