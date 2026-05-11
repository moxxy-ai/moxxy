import { describe, expect, it } from 'vitest';
import { Session } from './session.js';

describe('Session', () => {
  it('boots with sensible defaults', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    expect(s.id).toMatch(/^[0-9A-Z]+$/);
    expect(s.cwd).toBe('/tmp');
    expect(s.log.length).toBe(0);
    expect(s.signal.aborted).toBe(false);
  });

  it('abort flips signal', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    s.abort('test');
    expect(s.signal.aborted).toBe(true);
  });

  it('startTurn returns a fresh turn id', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const t1 = s.startTurn().turnId;
    const t2 = s.startTurn().turnId;
    expect(t1).not.toBe(t2);
  });

  it('exposes an immutable appContext snapshot', () => {
    const s = new Session({ cwd: '/tmp', silent: true });
    const ctx = s.appContext();
    expect(ctx.sessionId).toBe(s.id);
    expect(ctx.cwd).toBe('/tmp');
    expect(ctx.log.length).toBe(0);
  });
});
