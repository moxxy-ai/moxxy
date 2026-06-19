import { describe, expect, it } from 'vitest';
import { isValidCron, isValidTimeZone, nextFireTime, parseCron } from './cron.js';

describe('parseCron', () => {
  it('parses every-minute', () => {
    const c = parseCron('* * * * *');
    expect(c.minute.values.size).toBe(60);
    expect(c.hour.values.size).toBe(24);
    expect(c.minute.restricted).toBe(false);
  });

  it('parses a literal', () => {
    const c = parseCron('0 9 * * *');
    expect([...c.minute.values]).toEqual([0]);
    expect([...c.hour.values]).toEqual([9]);
    expect(c.minute.restricted).toBe(true);
  });

  it('parses a range', () => {
    const c = parseCron('0 9-11 * * *');
    expect([...c.hour.values]).toEqual([9, 10, 11]);
  });

  it('parses a list', () => {
    const c = parseCron('0 0,12,18 * * *');
    expect([...c.hour.values].sort((a, b) => a - b)).toEqual([0, 12, 18]);
  });

  it('parses a step', () => {
    const c = parseCron('*/15 * * * *');
    expect([...c.minute.values].sort((a, b) => a - b)).toEqual([0, 15, 30, 45]);
    expect(c.minute.restricted).toBe(false);
  });

  it('parses a range with step', () => {
    const c = parseCron('0 9-17/2 * * *');
    expect([...c.hour.values].sort((a, b) => a - b)).toEqual([9, 11, 13, 15, 17]);
  });

  it('rejects out-of-range', () => {
    expect(() => parseCron('0 25 * * *')).toThrow();
  });

  it('rejects wrong-arity', () => {
    expect(() => parseCron('0 9 *')).toThrow();
  });

  it('isValidCron returns false on garbage', () => {
    expect(isValidCron('not a cron')).toBe(false);
    expect(isValidCron('0 9 * * *')).toBe(true);
  });
});

describe('nextFireTime', () => {
  it('finds the next 9 AM', () => {
    // Mon 2026-05-11 08:30 local → next 9 AM is same day 09:00
    const after = new Date(2026, 4, 11, 8, 30, 0);
    const next = nextFireTime('0 9 * * *', after);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getDate()).toBe(11);
  });

  it('wraps to next day when already past', () => {
    const after = new Date(2026, 4, 11, 10, 0, 0);
    const next = nextFireTime('0 9 * * *', after);
    expect(next!.getDate()).toBe(12);
    expect(next!.getHours()).toBe(9);
  });

  it('every-15-min fires at the next quarter', () => {
    const after = new Date(2026, 4, 11, 10, 7, 0);
    const next = nextFireTime('*/15 * * * *', after);
    expect(next!.getHours()).toBe(10);
    expect(next!.getMinutes()).toBe(15);
  });

  it('every hour at minute 30 finds the next half-hour', () => {
    const after = new Date(2026, 4, 11, 10, 45, 0);
    const next = nextFireTime('30 * * * *', after);
    expect(next!.getHours()).toBe(11);
    expect(next!.getMinutes()).toBe(30);
  });

  it('returns null for impossible expressions', () => {
    // Feb 30th never exists.
    const after = new Date(2026, 0, 1, 0, 0, 0);
    const next = nextFireTime('0 0 30 2 *', after);
    expect(next).toBeNull();
  });

  it('honors DOW restriction', () => {
    // 2026-05-11 is a Monday. "9 AM on Sundays" -> next Sunday 2026-05-17
    const after = new Date(2026, 4, 11, 8, 0, 0);
    const next = nextFireTime('0 9 * * 0', after);
    expect(next!.getDay()).toBe(0);
    expect(next!.getDate()).toBe(17);
  });

  // u103-4: jumpToNextMonth must walk across a year boundary. From mid-year,
  // "midnight on Jan 1" lands on the following Jan 1.
  it('walks across a year boundary for an annual expression', () => {
    const after = new Date(2026, 5, 15, 12, 0, 0); // mid-June 2026
    const next = nextFireTime('0 0 1 1 *', after);
    expect(next).not.toBeNull();
    expect(next!.getFullYear()).toBe(2027);
    expect(next!.getMonth()).toBe(0); // January
    expect(next!.getDate()).toBe(1);
    expect(next!.getHours()).toBe(0);
    expect(next!.getMinutes()).toBe(0);
  });

  it('jumps to the next valid month within the same year', () => {
    // From January, "midnight on the 1st of March" -> 2026-03-01.
    const after = new Date(2026, 0, 10, 0, 0, 0); // 2026-01-10
    const next = nextFireTime('0 0 1 3 *', after);
    expect(next!.getFullYear()).toBe(2026);
    expect(next!.getMonth()).toBe(2); // March
    expect(next!.getDate()).toBe(1);
  });

  // u103-4: vixie-cron OR semantics — when BOTH DOM and DOW are restricted,
  // a fire matches on EITHER. `0 0 13 * 5` fires on the 13th OR any Friday.
  it('matches the soonest of DOM-13 OR Friday (DOW arm first)', () => {
    // After Sat 2026-06-06, the next Friday is 2026-06-12 (DOW arm), which
    // comes before the 13th (the DOM arm). So the Friday wins.
    const after = new Date(2026, 5, 6, 0, 0, 0); // Sat 2026-06-06
    const next = nextFireTime('0 0 13 * 5', after);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(12);
    expect(next!.getDay()).toBe(5); // Friday
  });

  it('matches the 13th via the DOM arm even when it is not a Friday', () => {
    // After Fri 2026-06-12 00:01, the next match is Sat 2026-06-13 — a 13th
    // that is NOT a Friday. AND-semantics would skip it; OR-semantics fires.
    const after = new Date(2026, 5, 12, 0, 1, 0); // just past midnight Fri 06-12
    const next = nextFireTime('0 0 13 * 5', after);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(13);
    expect(next!.getDay()).toBe(6); // Saturday — matched purely via DOM
  });

  // Regression for u103-1: with an explicit IANA zone the cursor walk must
  // match AND advance in that zone, not jump in the host-local zone. These
  // assertions hold regardless of the host TZ because they check the
  // absolute instant's wall-clock rendering in the target zone.
  const wallClockInZone = (d: Date, timeZone: string) => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
    return { hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
  };

  it('fires at 09:00 wall-clock in an explicit New York zone', () => {
    // Anchor far enough back that the host TZ cannot accidentally satisfy it.
    const after = new Date(Date.UTC(2026, 4, 11, 0, 0, 0));
    const next = nextFireTime('0 9 * * *', after, 'America/New_York');
    expect(next).not.toBeNull();
    const wc = wallClockInZone(next!, 'America/New_York');
    expect(wc.hour).toBe(9);
    expect(wc.minute).toBe(0);
  });

  it('fires at 09:00 wall-clock in an explicit Tokyo zone', () => {
    const after = new Date(Date.UTC(2026, 4, 11, 0, 0, 0));
    const next = nextFireTime('0 9 * * *', after, 'Asia/Tokyo');
    expect(next).not.toBeNull();
    const wc = wallClockInZone(next!, 'Asia/Tokyo');
    expect(wc.hour).toBe(9);
    expect(wc.minute).toBe(0);
  });

  it('handles spring-forward DST in an explicit zone', () => {
    // US spring-forward 2026: 2026-03-08, clocks jump 02:00 -> 03:00 EST->EDT.
    // "30 2 * * *" (02:30) does not exist that day; the next valid 02:30 is
    // the following day. The walk must not loop to the 1-year cap.
    const after = new Date(Date.UTC(2026, 2, 8, 0, 0, 0));
    const next = nextFireTime('30 2 * * *', after, 'America/New_York');
    expect(next).not.toBeNull();
    const wc = wallClockInZone(next!, 'America/New_York');
    expect(wc.hour).toBe(2);
    expect(wc.minute).toBe(30);
  });

  // Worst case: a non-IANA timeZone must NOT throw a RangeError out of
  // nextFireTime (which would abort the whole poller tick) — it returns null
  // (treated as "never due") instead.
  it('returns null instead of throwing for a non-IANA timeZone', () => {
    const after = new Date(Date.UTC(2026, 4, 11, 0, 0, 0));
    expect(() => nextFireTime('0 9 * * *', after, 'Mars/Phobos')).not.toThrow();
    expect(nextFireTime('0 9 * * *', after, 'Mars/Phobos')).toBeNull();
    // Other non-IANA strings are rejected the same way.
    expect(nextFireTime('0 9 * * *', after, 'Not/AZone')).toBeNull();
    expect(nextFireTime('0 9 * * *', after, '')).toBeNull();
  });
});

describe('isValidTimeZone', () => {
  it('accepts undefined / local / real IANA zones', () => {
    expect(isValidTimeZone(undefined)).toBe(true);
    expect(isValidTimeZone('local')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
  });

  it('rejects non-IANA strings that would make Intl throw', () => {
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
