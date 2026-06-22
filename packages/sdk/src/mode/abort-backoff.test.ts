import { describe, expect, it, vi } from 'vitest';
import { nextBackoffMs, sleepWithAbort } from './abort-backoff.js';

describe('nextBackoffMs', () => {
  it('grows exponentially from baseMs (1-based attempt)', () => {
    expect(nextBackoffMs(1, 500)).toBe(500);
    expect(nextBackoffMs(2, 500)).toBe(1000);
    expect(nextBackoffMs(3, 500)).toBe(2000);
    expect(nextBackoffMs(4, 500)).toBe(4000);
  });

  it('treats attempt <= 1 as baseMs', () => {
    expect(nextBackoffMs(0, 500)).toBe(500);
    expect(nextBackoffMs(-3, 500)).toBe(500);
  });

  it('caps at maxMs (default 30_000)', () => {
    expect(nextBackoffMs(20, 500)).toBe(30_000);
    expect(nextBackoffMs(20, 500, 5_000)).toBe(5_000);
  });
});

describe('sleepWithAbort', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    try {
      const p = sleepWithAbort(1000);
      vi.advanceTimersByTime(1000);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleepWithAbort(1000, ac.signal)).rejects.toBeDefined();
  });

  it('rejects on abort mid-sleep and leaves no abort listener leaked', async () => {
    const ac = new AbortController();
    const add = vi.spyOn(ac.signal, 'addEventListener');
    const p = sleepWithAbort(10_000, ac.signal);
    ac.abort();
    await expect(p).rejects.toBeDefined();
    // The once-listener is consumed by the abort; nothing keeps it attached.
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('removes the abort listener when it resolves normally (no leak)', async () => {
    vi.useFakeTimers();
    try {
      const ac = new AbortController();
      const remove = vi.spyOn(ac.signal, 'removeEventListener');
      const p = sleepWithAbort(50, ac.signal);
      vi.advanceTimersByTime(50);
      await p;
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
