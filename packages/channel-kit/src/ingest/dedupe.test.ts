import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryDedupeCache } from './dedupe.js';

describe('DeliveryDedupeCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('admits a new event_id once, then rejects the repeat', () => {
    const c = new DeliveryDedupeCache();
    expect(c.check('Ev123')).toBe(true);
    expect(c.check('Ev123')).toBe(false);
    expect(c.check('Ev123')).toBe(false);
  });

  it('distinct event ids are independent', () => {
    const c = new DeliveryDedupeCache();
    expect(c.check('Ev1')).toBe(true);
    expect(c.check('Ev2')).toBe(true);
    expect(c.check('Ev1')).toBe(false);
  });

  it('re-admits an event after its TTL has elapsed', () => {
    const c = new DeliveryDedupeCache({ ttlMs: 1000 });
    expect(c.check('k')).toBe(true);
    expect(c.check('k')).toBe(false);
    vi.setSystemTime(1000);
    expect(c.check('k')).toBe(false);
    vi.setSystemTime(2001);
    expect(c.check('k')).toBe(true);
  });

  it('evicts the oldest entry once maxEntries is exceeded', () => {
    const c = new DeliveryDedupeCache({ maxEntries: 2 });
    expect(c.check('a')).toBe(true);
    vi.setSystemTime(1);
    expect(c.check('b')).toBe(true);
    expect(c.size()).toBe(2);
    vi.setSystemTime(2);
    expect(c.check('c')).toBe(true); // evicts 'a'
    expect(c.size()).toBe(2);
    expect(c.check('a')).toBe(true); // 'a' was dropped → new again
  });

  it('clear() empties the cache', () => {
    const c = new DeliveryDedupeCache();
    c.check('a');
    c.check('b');
    expect(c.size()).toBe(2);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.check('a')).toBe(true);
  });
});
