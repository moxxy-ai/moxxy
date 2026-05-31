import { describe, expect, it } from 'vitest';

import {
  drivers,
  IpcError,
  publishDriver,
  resolveCtx,
  unpublishDriver,
  whenDriverReady,
} from './shared';
import type { SessionDriver } from '../session-driver';
import type { RunnerPool } from '../runner-pool';
import type { RunnerSupervisor } from '../runner-supervisor';

// Minimal pool/supervisor stand-ins: resolveCtx only touches
// pool.activeWorkspaceId / pool.get and supervisor.remote.
function fakePool(opts: {
  active: string | null;
  supervisors: Record<string, { remote: unknown } | undefined>;
}): RunnerPool {
  return {
    activeWorkspaceId: () => opts.active,
    get: (id: string) => opts.supervisors[id] as unknown as RunnerSupervisor | undefined,
  } as unknown as RunnerPool;
}

// The registry only stores driver objects and fires callbacks — a bare cast
// stands in for a real SessionDriver.
const fakeDriver = (tag: string): SessionDriver => ({ tag }) as unknown as SessionDriver;

describe('driver registry (deferred secondary attach)', () => {
  it('whenDriverReady fires immediately if the driver already exists', () => {
    const id = 'ws-immediate';
    const d = fakeDriver(id);
    publishDriver(id, d);
    let got: SessionDriver | null = null;
    whenDriverReady(id, (driver) => {
      got = driver;
    });
    expect(got).toBe(d);
    unpublishDriver(id);
  });

  it('whenDriverReady fires later when the driver is published', () => {
    const id = 'ws-deferred';
    expect(drivers.get(id)).toBeUndefined();
    let got: SessionDriver | null = null;
    whenDriverReady(id, (driver) => {
      got = driver;
    });
    expect(got).toBeNull(); // not yet
    const d = fakeDriver(id);
    publishDriver(id, d);
    expect(got).toBe(d);
    unpublishDriver(id);
  });

  it('drains multiple waiters once on publish', () => {
    const id = 'ws-multi';
    const fired: string[] = [];
    whenDriverReady(id, () => fired.push('a'));
    whenDriverReady(id, () => fired.push('b'));
    publishDriver(id, fakeDriver(id));
    expect(fired.sort()).toEqual(['a', 'b']);
    // A second publish must NOT re-fire the already-drained waiters.
    publishDriver(id, fakeDriver(id));
    expect(fired.sort()).toEqual(['a', 'b']);
    unpublishDriver(id);
  });

  it('cancel() unregisters a pending waiter', () => {
    const id = 'ws-cancel';
    let fired = false;
    const cancel = whenDriverReady(id, () => {
      fired = true;
    });
    cancel();
    publishDriver(id, fakeDriver(id));
    expect(fired).toBe(false);
    unpublishDriver(id);
  });
});

describe('resolveCtx', () => {
  it('throws no-workspace when nothing is active and none specified', () => {
    const pool = fakePool({ active: null, supervisors: {} });
    try {
      resolveCtx(pool);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(IpcError);
      expect((e as IpcError).code).toBe('no-workspace');
    }
  });

  it('throws not-connected when the supervisor has no session', () => {
    const pool = fakePool({ active: 'w1', supervisors: { w1: { remote: () => null } } });
    try {
      resolveCtx(pool);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as IpcError).code).toBe('not-connected');
    }
  });

  it('requireSession:false yields a null session instead of throwing', () => {
    const sup = { remote: () => null };
    const pool = fakePool({ active: 'w1', supervisors: { w1: sup } });
    const ctx = resolveCtx(pool, undefined, { requireSession: false });
    expect(ctx.workspaceId).toBe('w1');
    expect(ctx.session).toBeNull();
  });

  it('returns the session when connected', () => {
    const session = { tag: 'live' };
    const sup = { remote: () => session };
    const pool = fakePool({ active: 'w1', supervisors: { w1: sup } });
    const ctx = resolveCtx(pool, { workspaceId: 'w1' });
    expect(ctx.session).toBe(session);
  });
});
