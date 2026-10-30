import { describe, expect, it } from 'vitest';
import type { ScheduleEntry } from '@moxxy/plugin-scheduler';
import { fmtNext, fmtWindow } from './format.js';

/** Minimal valid ScheduleEntry, overridden per-case. */
function entry(over: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    id: 'id',
    name: 'job',
    prompt: 'do thing',
    enabled: true,
    createdAt: Date.UTC(2020, 0, 1),
    source: 'manual',
    ...over,
  } as ScheduleEntry;
}

describe('fmtNext', () => {
  it('formats the next fire of a cron relative to createdAt when never run', () => {
    // Every minute → the very next minute after createdAt.
    const out = fmtNext(entry({ cron: '* * * * *', timeZone: 'UTC' }));
    // createdAt = 2020-01-01T00:00:00Z → first fire 2020-01-01T00:01:00Z.
    expect(out).toBe('2020-01-01T00:01:00.000Z');
  });

  it('uses lastRunAt over createdAt when the cron has already fired', () => {
    const out = fmtNext(
      entry({
        cron: '* * * * *',
        timeZone: 'UTC',
        lastRunAt: Date.UTC(2021, 5, 15, 12, 0, 0),
      }),
    );
    expect(out).toBe('2021-06-15T12:01:00.000Z');
  });

  it('reports "(never — invalid)" for a valid-syntax cron that can never fire', () => {
    // Feb 30th never exists → no fire within the 366-day search window. No
    // timeZone so nextFireTime uses the fast local month-jump path rather than
    // a minute-by-minute walk.
    const out = fmtNext(entry({ cron: '0 0 30 2 *' }));
    expect(out).toBe('(never — invalid)');
  });

  it('formats an enabled one-shot as the runAt ISO timestamp', () => {
    const runAt = Date.UTC(2030, 2, 3, 4, 5, 6);
    const out = fmtNext(entry({ runAt, enabled: true }));
    expect(out).toBe(new Date(runAt).toISOString());
  });

  it('reports "(done)" for a disabled one-shot (already fired)', () => {
    const out = fmtNext(entry({ runAt: Date.UTC(2030, 0, 1), enabled: false }));
    expect(out).toBe('(done)');
  });

  it('reports "(done)" for an entry with neither cron nor runAt', () => {
    const out = fmtNext(entry({ enabled: true }));
    expect(out).toBe('(done)');
  });
});

describe('schedule time window in `moxxy schedule list`', () => {
  const startAt = Date.UTC(2030, 9, 29, 22, 0);
  const endAt = Date.UTC(2030, 9, 30, 6, 0);

  it('shows the window opening as the next fire, not the minute after creation', () => {
    const out = fmtNext(entry({ cron: '*/30 * * * *', timeZone: 'UTC', startAt, endAt }));
    expect(out).toBe(new Date(startAt).toISOString());
  });

  it('says the window ended once no run is left in it', () => {
    const out = fmtNext(
      entry({ cron: '*/30 * * * *', timeZone: 'UTC', startAt, endAt, lastRunAt: endAt, enabled: false }),
    );
    expect(out).toBe('(window ended)');
  });

  it('describes the window next to the cron', () => {
    expect(fmtWindow(entry({ cron: '*/30 * * * *', startAt, endAt }))).toBe(
      ` from ${new Date(startAt).toISOString()} until ${new Date(endAt).toISOString()}`,
    );
    expect(fmtWindow(entry({ cron: '*/30 * * * *', endAt }))).toBe(
      ` until ${new Date(endAt).toISOString()}`,
    );
    expect(fmtWindow(entry({ cron: '*/30 * * * *' }))).toBe('');
  });
});
