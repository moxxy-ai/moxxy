import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
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

  it('echoes the real id on a missing-method error so the parent can settle the call', async () => {
    const writes: Reply[] = [];
    const out = (reply: Reply): void => void writes.push(reply);
    // id round-trips, only `method` is missing — the reply MUST carry the real
    // id (not 'unknown') so the parent's pending map matches and the caller is
    // rejected instead of left waiting for its timeout.
    await enqueueLine(JSON.stringify({ id: 'real-id' }), out);
    expect(writes).toHaveLength(1);
    const write0 = writes[0];
    assertDefined(write0, 'writes has length 1');
    expect(write0.id).toBe('real-id');
    expect(write0.ok).toBe(false);
  });

  it('falls back to "unknown" for wholly unparseable input', async () => {
    const writes: Reply[] = [];
    const out = (reply: Reply): void => void writes.push(reply);
    await enqueueLine('{not json', out);
    const write0 = writes[0];
    assertDefined(write0, 'enqueueLine wrote a reply');
    expect(write0.id).toBe('unknown');
    expect(write0.ok).toBe(false);
  });
});
