import { describe, it, expect } from 'vitest';
import { defineSurface, type SurfaceInstance } from '@moxxy/sdk';
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
