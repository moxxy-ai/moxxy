import { describe, it, expect, vi } from 'vitest';
import {
  defineSurface,
  type SurfaceDataMessage,
  type SurfaceInstance,
  type SurfaceSize,
} from '@moxxy/sdk';
import { SurfaceHostImpl } from './host.js';
import { SurfaceRegistryImpl } from '../registries/surfaces.js';

/**
 * A fake surface whose instance records the input it receives and whether it has
 * been closed — enough to assert that the host routes a viewer's keystrokes to
 * the live instance and only tears it down when the last viewer detaches.
 */
function fakeSurface(kind = 'terminal') {
  const state = { inputs: [] as unknown[], closed: 0, opens: 0 };
  const def = defineSurface({
    kind,
    open: () => {
      state.opens += 1;
      const instance: SurfaceInstance = {
        id: kind,
        kind,
        onData: () => () => {},
        snapshot: () => ({ type: 'snapshot' }),
        input: (msg) => {
          state.inputs.push(msg);
        },
        close: () => {
          state.closed += 1;
        },
      };
      return instance;
    },
  });
  return { def, state };
}

function makeHost(def: ReturnType<typeof fakeSurface>['def']): SurfaceHostImpl {
  const registry = new SurfaceRegistryImpl();
  registry.register(def);
  return new SurfaceHostImpl(registry, { cwd: '/tmp' });
}

describe('SurfaceHostImpl viewer ref-counting', () => {
  it('keeps a shared instance alive until the last viewer closes', async () => {
    const { def, state } = fakeSurface();
    const host = makeHost(def);

    const a = await host.open('terminal');
    const b = await host.open('terminal');
    expect(state.opens).toBe(1); // shared: one underlying instance
    expect(a.surfaceId).toBe(b.surfaceId);

    // First viewer detaches — instance must survive for the second.
    await host.close(a.surfaceId);
    expect(state.closed).toBe(0);

    // Input from the still-attached viewer reaches the live instance.
    await host.input(b.surfaceId, { type: 'data', data: 'ls\n' });
    expect(state.inputs).toEqual([{ type: 'data', data: 'ls\n' }]);

    // Last viewer detaches — now it tears down.
    await host.close(b.surfaceId);
    expect(state.closed).toBe(1);
  });

  it('survives the StrictMode mount→unmount→remount close race', async () => {
    // React StrictMode double-invokes effects: the first mount opens, unmounts
    // (its late-resolving open then fires a close), and a second mount opens the
    // shared instance. The stray close must NOT destroy the instance the live
    // mount is using — otherwise input/resize silently vanish.
    const { def, state } = fakeSurface();
    const host = makeHost(def);

    const first = await host.open('terminal'); // mount A
    const second = await host.open('terminal'); // mount B (remount)
    await host.close(first.surfaceId); // mount A's disposed-open close

    expect(state.closed).toBe(0); // instance survived
    await host.input(second.surfaceId, { type: 'data', data: 'x' });
    expect(state.inputs).toEqual([{ type: 'data', data: 'x' }]); // input still lands
  });

  it('closeAll tears down regardless of outstanding viewer refs', async () => {
    const { def, state } = fakeSurface();
    const host = makeHost(def);
    await host.open('terminal');
    await host.open('terminal'); // ref count 2
    await host.closeAll();
    expect(state.closed).toBe(1);
  });
});

describe('SurfaceHostImpl shutdown leak/hang hardening', () => {
  it('closeAll closes an open() that resolves AFTER teardown (no leaked instance)', async () => {
    // The open()'s def.open promise resolves only after closeAll has run; the
    // freshly-created instance must be torn down, not installed as an orphan.
    let resolveOpen!: () => void;
    const gate = new Promise<void>((r) => {
      resolveOpen = r;
    });
    const state = { closed: 0, instances: [] as SurfaceInstance[] };
    const def = defineSurface({
      kind: 'terminal',
      open: async () => {
        await gate;
        const instance: SurfaceInstance = {
          id: 'terminal',
          kind: 'terminal',
          onData: () => () => {},
          input: () => {},
          close: () => {
            state.closed += 1;
          },
        };
        state.instances.push(instance);
        return instance;
      },
    });
    const host = makeHost(def);

    const openPromise = host.open('terminal'); // in-flight, parked on the gate
    const closeAll = host.closeAll(); // sets disposed; awaits the in-flight open
    resolveOpen(); // open resolves only now, after teardown began
    await expect(openPromise).rejects.toThrow(/has been closed/);
    await closeAll;

    // The instance was created — and immediately closed, never installed.
    expect(state.instances).toHaveLength(1);
    expect(state.closed).toBe(1);
    // A stray open() after shutdown is rejected before creating anything.
    await expect(host.open('terminal')).rejects.toThrow(/has been closed/);
  });

  it('a wedged instance.close() does not hang closeAll forever', async () => {
    vi.useFakeTimers();
    try {
      const state = { closed: 0 };
      const def = defineSurface({
        kind: 'terminal',
        open: () => ({
          id: 'terminal',
          kind: 'terminal',
          onData: () => () => {},
          input: () => {},
          // Never resolves: a wedged PTY/browser teardown.
          close: () => new Promise<void>(() => {}),
        }),
      });
      const host = makeHost(def);
      await host.open('terminal');

      const done = host.closeAll();
      // Without the timeout this would never settle; advance past it.
      await vi.advanceTimersByTimeAsync(6000);
      await expect(done).resolves.toBeUndefined();
      expect(state.closed).toBe(0); // close() never resolved, but we moved on
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A controllable surface whose instance lets the test PUSH frames (`emit`),
 * record resize calls, and run unsubscribe on close — enough to assert the
 * host's multiplex fan-out, the per-instance unsub drop, and id-based routing.
 */
function controllableSurface(kind = 'terminal') {
  const subscribers = new Set<(payload: unknown) => void>();
  const state = {
    opens: 0,
    closed: 0,
    inputs: [] as unknown[],
    resizes: [] as SurfaceSize[],
    unsubs: 0,
  };
  const instance: SurfaceInstance = {
    id: `${kind}-id`,
    kind,
    onData: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
        state.unsubs += 1;
      };
    },
    snapshot: () => ({ scrollback: 'hello' }),
    input: (msg) => {
      state.inputs.push(msg);
    },
    resize: (size) => {
      state.resizes.push(size);
    },
    close: () => {
      state.closed += 1;
    },
  };
  const def = defineSurface({
    kind,
    description: 'controllable',
    open: () => {
      state.opens += 1;
      return instance;
    },
  });
  /** Push one frame as the underlying instance would. */
  const emit = (payload: unknown): void => {
    for (const cb of subscribers) cb(payload);
  };
  return { def, state, instance, emit };
}

describe('SurfaceHostImpl open() idempotence + snapshot', () => {
  it('returns the existing instance + its snapshot on a second open(kind)', async () => {
    const { def, state } = controllableSurface();
    const host = makeHost(def);

    const a = await host.open('terminal');
    const b = await host.open('terminal');

    expect(state.opens).toBe(1); // def.open ran exactly once
    expect(a.surfaceId).toBe(b.surfaceId);
    expect(a.kind).toBe('terminal');
    // The catch-up snapshot rides back to a late-joining viewer.
    expect(a.snapshot).toEqual({ scrollback: 'hello' });
    expect(b.snapshot).toEqual({ scrollback: 'hello' });
  });

  it('two concurrent open(kind) calls share ONE instance (def.open runs once)', async () => {
    const { def, state } = controllableSurface();
    const host = makeHost(def);

    const [a, b] = await Promise.all([host.open('terminal'), host.open('terminal')]);

    expect(state.opens).toBe(1);
    expect(a.surfaceId).toBe(b.surfaceId);
  });

  it('throws a clear error opening an unregistered kind', async () => {
    const { def } = controllableSurface();
    const host = makeHost(def);
    await expect(host.open('browser')).rejects.toThrow(/No surface registered for kind: browser/);
  });
});

describe('SurfaceHostImpl onData multiplex fan-out', () => {
  it('re-emits each instance frame as a SurfaceDataMessage carrying surfaceId/kind/payload', async () => {
    const { def, emit } = controllableSurface();
    const host = makeHost(def);
    const { surfaceId } = await host.open('terminal');

    const seen: SurfaceDataMessage[] = [];
    host.onData((msg) => seen.push(msg));
    emit({ bytes: 'ls\n' });

    expect(seen).toEqual([{ surfaceId, kind: 'terminal', payload: { bytes: 'ls\n' } }]);
  });

  it('fans every frame out to all subscribers', async () => {
    const { def, emit } = controllableSurface();
    const host = makeHost(def);
    await host.open('terminal');

    const a: SurfaceDataMessage[] = [];
    const b: SurfaceDataMessage[] = [];
    host.onData((m) => a.push(m));
    host.onData((m) => b.push(m));
    emit({ x: 1 });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('a throwing listener does not suppress delivery to the others', async () => {
    const { def, emit } = controllableSurface();
    const host = makeHost(def);
    await host.open('terminal');

    const good: SurfaceDataMessage[] = [];
    host.onData(() => {
      throw new Error('bad listener');
    });
    host.onData((m) => good.push(m));

    expect(() => emit({ x: 1 })).not.toThrow();
    expect(good).toHaveLength(1);
  });

  it('the onData unsubscribe stops further frames for that subscriber', async () => {
    const { def, emit } = controllableSurface();
    const host = makeHost(def);
    await host.open('terminal');

    const seen: SurfaceDataMessage[] = [];
    const off = host.onData((m) => seen.push(m));
    emit({ n: 1 });
    off();
    emit({ n: 2 });

    expect(seen).toHaveLength(1);
  });

  it('drops the per-instance unsub on close so no frames flow after teardown', async () => {
    const { def, state, emit } = controllableSurface();
    const host = makeHost(def);
    const { surfaceId } = await host.open('terminal');

    const seen: SurfaceDataMessage[] = [];
    host.onData((m) => seen.push(m));
    await host.close(surfaceId); // last viewer → real teardown

    expect(state.closed).toBe(1);
    expect(state.unsubs).toBe(1); // the host ran the stored unsub
    emit({ late: true }); // frame from a still-live resource, post-close
    expect(seen).toHaveLength(0); // host no longer forwards it
  });
});

describe('SurfaceHostImpl input/resize routing', () => {
  it('routes input + resize to the instance by surfaceId', async () => {
    const { def, state } = controllableSurface();
    const host = makeHost(def);
    const { surfaceId } = await host.open('terminal');

    await host.input(surfaceId, { type: 'data', data: 'x' });
    await host.resize(surfaceId, { cols: 80, rows: 24 });

    expect(state.inputs).toEqual([{ type: 'data', data: 'x' }]);
    expect(state.resizes).toEqual([{ cols: 80, rows: 24 }]);
  });

  it('no-ops on an unknown surfaceId (input + resize)', async () => {
    const { def, state } = controllableSurface();
    const host = makeHost(def);
    await host.open('terminal');

    await host.input('does-not-exist', { type: 'data', data: 'x' });
    await host.resize('does-not-exist', { cols: 1, rows: 1 });

    expect(state.inputs).toEqual([]);
    expect(state.resizes).toEqual([]);
  });

  it('close on an unknown surfaceId is a no-op (does not tear down the live one)', async () => {
    const { def, state } = controllableSurface();
    const host = makeHost(def);
    await host.open('terminal');

    await host.close('does-not-exist');
    expect(state.closed).toBe(0);
  });
});

describe('SurfaceHostImpl list()', () => {
  it('reports the registered kinds with availability', async () => {
    const registry = new SurfaceRegistryImpl();
    registry.register(controllableSurface('terminal').def);
    registry.register(
      defineSurface({
        kind: 'browser',
        description: 'headless browser',
        open: () => {
          throw new Error('unused');
        },
        isAvailable: () => ({ ok: false, reason: 'node-pty missing' }),
      }),
    );
    const host = new SurfaceHostImpl(registry, { cwd: '/tmp' });

    const list = await host.list();
    const byKind = new Map(list.map((i) => [i.kind, i]));
    expect(byKind.get('terminal')).toMatchObject({ available: true, description: 'controllable' });
    expect(byKind.get('browser')).toMatchObject({
      available: false,
      reason: 'node-pty missing',
    });
  });

  it('treats a throwing isAvailable as unavailable with the error as reason', async () => {
    const registry = new SurfaceRegistryImpl();
    registry.register(
      defineSurface({
        kind: 'terminal',
        open: () => {
          throw new Error('unused');
        },
        isAvailable: () => {
          throw new Error('probe blew up');
        },
      }),
    );
    const host = new SurfaceHostImpl(registry, { cwd: '/tmp' });

    const [info] = await host.list();
    expect(info).toMatchObject({ kind: 'terminal', available: false, reason: 'probe blew up' });
  });
});
