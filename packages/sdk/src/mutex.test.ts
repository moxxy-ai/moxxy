import { describe, expect, it } from 'vitest';
import { createMutex } from './mutex.js';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('createMutex', () => {
  it('serializes overlapping runs (no interleave)', async () => {
    const mutex = createMutex();
    const order: string[] = [];
    const slow = mutex.run(async () => {
      order.push('a:start');
      await tick(20);
      order.push('a:end');
    });
    const fast = mutex.run(async () => {
      order.push('b:start');
      await tick(1);
      order.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('returns the callback result', async () => {
    const mutex = createMutex();
    await expect(mutex.run(() => 42)).resolves.toBe(42);
    await expect(mutex.run(async () => 'x')).resolves.toBe('x');
  });

  it('keeps the lock alive after a rejection', async () => {
    const mutex = createMutex();
    await expect(mutex.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // Next run must still execute — the chain isn't poisoned.
    await expect(mutex.run(() => 'recovered')).resolves.toBe('recovered');
  });
});
