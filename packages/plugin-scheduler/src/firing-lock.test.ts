import { describe, expect, it } from 'vitest';
import { FiringLock } from './firing-lock.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('FiringLock', () => {
  it('serializes same-id calls — they never overlap', async () => {
    const lock = new FiringLock();
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];
    const job = (n: number) =>
      lock.run('same', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        order.push(n);
        active -= 1;
      });
    await Promise.all([job(1), job(2), job(3)]);
    expect(maxActive).toBe(1); // never two at once
    expect(order).toEqual([1, 2, 3]); // FIFO order preserved
  });

  it('runs distinct ids concurrently (no head-of-line blocking)', async () => {
    const lock = new FiringLock();
    let active = 0;
    let maxActive = 0;
    const job = (id: string) =>
      lock.run(id, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
      });
    await Promise.all([job('a'), job('b'), job('c')]);
    expect(maxActive).toBeGreaterThan(1); // they overlapped
  });

  it('a throwing fire does not reject the calls queued behind it, and they still serialize', async () => {
    const lock = new FiringLock();
    let firstDone = false;
    let secondStartedAfterFirst = false;
    const p1 = lock.run('same', async () => {
      await tick();
      firstDone = true;
      throw new Error('boom');
    });
    const p2 = lock.run('same', async () => {
      // Must observe the first fire as complete — it was NOT skipped by the throw.
      secondStartedAfterFirst = firstDone;
      return 'ok';
    });
    // The throwing fire rejects to ITS caller only.
    await expect(p1).rejects.toThrow('boom');
    // The queued fire still runs and resolves normally.
    await expect(p2).resolves.toBe('ok');
    expect(secondStartedAfterFirst).toBe(true);
  });

  it('prunes drained id chains so the map does not grow unbounded', async () => {
    const lock = new FiringLock();
    for (let i = 0; i < 50; i += 1) {
      await lock.run(`one-shot-${i}`, async () => undefined);
    }
    const chains = (lock as unknown as { chains: Map<string, unknown> }).chains;
    expect(chains.size).toBe(0);
  });
});
