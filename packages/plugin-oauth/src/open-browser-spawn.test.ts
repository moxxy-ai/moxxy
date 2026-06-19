import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock node:child_process so we can drive spawn's error/success timing
// deterministically without launching a real browser opener.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Imported AFTER the mock is registered.
const { openInBrowser } = await import('./open-browser.js');

interface FakeChild extends EventEmitter {
  unref: () => void;
}

function fakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  ee.unref = vi.fn();
  return ee;
}

afterEach(() => {
  spawnMock.mockReset();
});

describe('openInBrowser — failure path degrades, never hangs or leaks', () => {
  it('rejects when the opener process emits a spawn error (does NOT swallow it into a resolve)', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const p = openInBrowser('https://example.test/auth?a=1&b=2');
    // Fire the spawn error synchronously after the call returns.
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    await expect(p).rejects.toThrow(/ENOENT/);
  });

  it('a LATE error after settle is swallowed, never an unhandled (fatal) error event', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const p = openInBrowser('https://example.test/auth');
      // Advance past the 50ms settle so the success path resolves first.
      await vi.advanceTimersByTimeAsync(60);
      await expect(p).resolves.toBeUndefined();
      // A late async spawn failure must not throw. The error listener stays
      // attached (a listenerless 'error' event crashes the process in Node), so
      // the late error is handled and harmlessly ignored.
      expect(() => child.emit('error', new Error('late'))).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves after the spawn tick on the happy path and unrefs the child', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.mockReturnValue(child);
      const p = openInBrowser('https://example.test/auth');
      await vi.advanceTimersByTimeAsync(60);
      await expect(p).resolves.toBeUndefined();
      expect(child.unref).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
