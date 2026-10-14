import { describe, expect, it } from 'vitest';

import { OutboundBacklogGuard } from './backlog-guard.js';

const MB = 1024 * 1024;

describe('OutboundBacklogGuard', () => {
  it('keeps a reader that is still draining one large frame', () => {
    const guard = new OutboundBacklogGuard(4 * MB, 10_000, 256 * MB);
    // A 20 MB history page goes out in one write…
    expect(guard.check(0, 0)).toBe('ok');
    guard.recordSent(20 * MB);
    // …and the next small event finds most of it still queued. A reader that
    // keeps taking bytes is healthy, however long one big frame takes.
    expect(guard.check(20 * MB, 1)).toBe('ok');
    guard.recordSent(100);
    for (let t = 1; t <= 60; t += 1) {
      expect(guard.check(20 * MB - t * 300_000, t * 1000)).toBe('ok');
    }
  });

  it('evicts a reader that stops taking bytes for the grace window', () => {
    const guard = new OutboundBacklogGuard(4 * MB, 10_000, 256 * MB);
    guard.recordSent(6 * MB);
    expect(guard.check(6 * MB, 0)).toBe('ok');
    expect(guard.check(6 * MB, 9_999)).toBe('ok');
    expect(guard.check(6 * MB, 10_000)).toBe('terminate');
  });

  it('restarts the grace window whenever the reader makes progress', () => {
    const guard = new OutboundBacklogGuard(4 * MB, 10_000, 256 * MB);
    guard.recordSent(8 * MB);
    expect(guard.check(8 * MB, 0)).toBe('ok');
    expect(guard.check(7 * MB, 9_000)).toBe('ok');
    expect(guard.check(7 * MB, 18_000)).toBe('ok');
    expect(guard.check(7 * MB, 19_000)).toBe('terminate');
  });

  it('still bounds memory with the hard ceiling', () => {
    const guard = new OutboundBacklogGuard(4 * MB, 10_000, 256 * MB);
    expect(guard.check(256 * MB + 1, 0)).toBe('terminate');
  });

  it('defaults the hard ceiling to four times the soft limit', () => {
    const guard = new OutboundBacklogGuard(100, 1000);
    expect(guard.check(400, 0)).toBe('ok');
    expect(guard.check(401, 0)).toBe('terminate');
  });
});
