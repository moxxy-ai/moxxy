/**
 * Unit tests for the generic external-store primitives that back the
 * desks / sessions / connection module stores (and React's
 * `useSyncExternalStore`). Asserts the contract those stores rely on:
 * subscribe fires on change, the snapshot keeps a stable identity until a
 * mutation, and the optimistic switch applies-then-rolls-back (store + the
 * captured connection active id) on failure without rethrowing.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createListenerSet,
  createPatchStore,
  runOptimistic,
  type ActiveBinding,
} from './externalStore.js';

describe('createListenerSet', () => {
  it('emits to every current listener in insertion order', () => {
    const ls = createListenerSet();
    const calls: number[] = [];
    ls.subscribe(() => calls.push(1));
    ls.subscribe(() => calls.push(2));
    ls.emit();
    expect(calls).toEqual([1, 2]);
  });

  it('unsubscribe removes exactly that listener', () => {
    const ls = createListenerSet();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = ls.subscribe(a);
    ls.subscribe(b);
    unsubA();
    ls.emit();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

interface Counter {
  readonly n: number;
  readonly label: string;
}

describe('createPatchStore', () => {
  it('subscribe fires on every set / replace', () => {
    const store = createPatchStore<Counter>({ n: 0, label: 'a' });
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ n: 1 });
    store.replace({ n: 2, label: 'b' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('snapshot identity is stable until a mutation, then swaps', () => {
    const store = createPatchStore<Counter>({ n: 0, label: 'a' });
    const first = store.getSnapshot();
    // No mutation: identical reference (so useSyncExternalStore won't tear).
    expect(store.getSnapshot()).toBe(first);
    store.set({ n: 1 });
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(second).toEqual({ n: 1, label: 'a' });
    // Stable again after the change.
    expect(store.getSnapshot()).toBe(second);
  });

  it('set shallow-merges, replace swaps the whole snapshot', () => {
    const store = createPatchStore<Counter>({ n: 0, label: 'a' });
    store.set({ n: 5 });
    expect(store.getSnapshot()).toEqual({ n: 5, label: 'a' });
    store.replace({ n: 9, label: 'z' });
    expect(store.getSnapshot()).toEqual({ n: 9, label: 'z' });
  });

  it('a removed subscriber stops receiving updates', () => {
    const store = createPatchStore<Counter>({ n: 0, label: 'a' });
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.set({ n: 1 });
    unsub();
    store.set({ n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/** A minimal in-memory connection-active binding for the switch tests. */
function fakeConn(initial: string | null): ActiveBinding & { current: string | null } {
  const box = {
    current: initial,
    active$: () => box.current,
    setActive: (id: string | null) => {
      box.current = id;
    },
  };
  return box;
}

describe('runOptimistic', () => {
  it('applies optimistically and keeps the change when the commit resolves', async () => {
    const conn = fakeConn('s1');
    let activeId = 's1';
    await runOptimistic(
      conn,
      () => {
        activeId = 's2';
        conn.setActive('s2');
      },
      async () => {
        /* commit succeeds */
      },
      () => {
        activeId = 's1';
      },
    );
    expect(activeId).toBe('s2');
    expect(conn.active$()).toBe('s2');
  });

  it('the optimistic mutation is visible while the commit is still in flight', async () => {
    const conn = fakeConn('s1');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const done = runOptimistic(
      conn,
      () => conn.setActive('s2'),
      async () => {
        await gate;
      },
      () => conn.setActive('s1'),
    );
    // Before the commit resolves, the optimistic flip is already applied.
    expect(conn.active$()).toBe('s2');
    release();
    await done;
    expect(conn.active$()).toBe('s2');
  });

  it('rolls back BOTH the store rollback and the connection active id on failure, without rethrowing', async () => {
    const conn = fakeConn('s1');
    let activeId = 's1';
    const rollback = vi.fn((_e: unknown) => {
      activeId = 's1';
    });
    await expect(
      runOptimistic(
        conn,
        () => {
          activeId = 's2';
          conn.setActive('s2');
        },
        async () => {
          throw new Error('boom');
        },
        rollback,
      ),
    ).resolves.toBeUndefined();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(activeId).toBe('s1');
    expect(conn.active$()).toBe('s1');
  });

  it('does not restore the connection id when there was no prior active id', async () => {
    const conn = fakeConn(null);
    await runOptimistic(
      conn,
      () => conn.setActive('s2'),
      async () => {
        throw new Error('boom');
      },
      () => {
        /* store rollback only */
      },
    );
    // prevConn was null → optimistic value is left in place (matches the
    // `if (prevConn) conn.setActive(prevConn)` guard in the call sites).
    expect(conn.active$()).toBe('s2');
  });
});
