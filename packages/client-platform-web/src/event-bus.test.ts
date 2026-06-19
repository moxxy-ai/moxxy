/**
 * event-bus graceful-degradation tests. The bus must degrade to `undefined`
 * off-DOM (worker / SSR / RN bundle) instead of throwing a ReferenceError on the
 * bare `window` global — the package's documented contract (mirrors kv.ts). The
 * export is decided at module load, so each case re-imports with the global set.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('webEventBus', () => {
  it('is undefined when there is no window (degrades, never throws)', async () => {
    vi.stubGlobal('window', undefined);
    vi.resetModules();
    const { webEventBus } = await import('./event-bus.js');
    expect(webEventBus).toBeUndefined();
  });

  it('wires window add/remove/dispatch when a window exists', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { addEventListener, removeEventListener, dispatchEvent });
    vi.resetModules();
    const { webEventBus } = await import('./event-bus.js');
    expect(webEventBus).toBeDefined();

    const handler = (): void => {};
    const off = webEventBus!.on('x', handler);
    expect(addEventListener).toHaveBeenCalledWith('x', handler);

    off();
    expect(removeEventListener).toHaveBeenCalledWith('x', handler);

    webEventBus!.emit('y');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
