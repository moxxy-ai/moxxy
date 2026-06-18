import { describe, expect, it } from 'vitest';
import { isValidCron, nextFireTime, parseCron } from './cron.js';

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
});
