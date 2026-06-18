import { describe, expect, it } from 'vitest';
import { rejectAllPending, type PendingEntry } from './useNer';
import type { NerToken } from './aggregate';

describe('rejectAllPending', () => {
  it('rejects every in-flight request and empties the map', async () => {
    const pending = new Map<number, PendingEntry>();
    // Two in-flight requests, exactly as detectNames registers them.
    const p1 = new Promise<NerToken[]>((resolve, reject) => pending.set(1, { resolve, reject }));
    const p2 = new Promise<NerToken[]>((resolve, reject) => pending.set(2, { resolve, reject }));
    expect(pending.size).toBe(2);

    rejectAllPending(pending, 'NER worker stopped');

    // Both settle (REJECT) — without the fix these promises would hang forever.
    await expect(p1).rejects.toThrow('NER worker stopped');
    await expect(p2).rejects.toThrow('NER worker stopped');
    expect(pending.size).toBe(0);
  });

  it('is a no-op on an empty map', () => {
    const pending = new Map<number, PendingEntry>();
    expect(() => rejectAllPending(pending, 'stopped')).not.toThrow();
    expect(pending.size).toBe(0);
  });

  it('clears the map before rejecting so a re-entrant teardown cannot double-settle', async () => {
    const pending = new Map<number, PendingEntry>();
    let observedSizeDuringReject = -1;
    const p = new Promise<NerToken[]>((resolve, reject) => {
      pending.set(1, {
        resolve,
        reject: (e) => {
          // The map must already be empty by the time any reject runs, so a
          // teardown that fires while a reject handler runs finds nothing left.
          observedSizeDuringReject = pending.size;
          reject(e);
        },
      });
    });
    rejectAllPending(pending, 'stopped');
    await expect(p).rejects.toThrow('stopped');
    expect(observedSizeDuringReject).toBe(0);
  });
});
