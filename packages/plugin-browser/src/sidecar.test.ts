import { describe, expect, it } from 'vitest';
import { enqueueLine } from './sidecar.js';
import type { Reply } from './sidecar/types.js';

/**
 * The serial request queue chains each link off the previous one. A throw from
 * the reply sink (real run: a broken stdout pipe on `process.stdout.write`) used
 * to reject the shared `queue` promise permanently, stranding EVERY subsequent
 * request. The `.catch` on the chained link must keep the queue alive so the
 * next request still serves. We drive `enqueueLine` directly with a stub sink
 * (and an unknown method, so dispatch never touches Playwright).
 */
describe('sidecar request queue resilience', () => {
  it('keeps serving after the reply sink throws once', async () => {
    const writes: Reply[] = [];
    let firstWriteThrew = false;
    const out = (reply: Reply): void => {
      if (!firstWriteThrew) {
        firstWriteThrew = true;
        throw new Error('EPIPE: broken pipe'); // poison the first reply write
      }
      writes.push(reply);
    };

    // Request 1: its reply write throws; the link's `.catch` retries the write
    // (now succeeding) instead of poisoning the queue.
    await enqueueLine(JSON.stringify({ id: 'a', method: 'noop' }), out);
    // Request 2: must STILL get a reply — the queue wasn't stranded.
    await enqueueLine(JSON.stringify({ id: 'b', method: 'noop' }), out);

    expect(firstWriteThrew).toBe(true);
    const ids = writes.map((r) => r.id);
    expect(ids).toContain('b'); // the next request was served
    // Request 1's error reply lands too (its catch-path re-wrote it).
    expect(ids).toContain('a');
  });
});
