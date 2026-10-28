import { describe, expect, it } from 'vitest';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { scheduleWhen, windowLabel } from './schedule-labels';

const startAt = new Date(2026, 9, 29, 23, 0).getTime();
const endAt = new Date(2026, 9, 30, 7, 0).getTime();
const before = new Date(2026, 9, 28, 18, 0).getTime();
const at = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
const atFull = (ms: number) => new Date(ms).toLocaleString();

describe('windowLabel', () => {
  it('shows both ends of a time window', () => {
    expect(windowLabel({ startAt, endAt }, before)).toBe(`${at(startAt)} → ${at(endAt)}`);
  });

  it('shows a window with only one end', () => {
    expect(windowLabel({ endAt }, before)).toBe(`until ${at(endAt)}`);
    expect(windowLabel({ startAt, endAt: null }, before)).toBe(`from ${at(startAt)}`);
  });

  it('says the window ended once its end is past, so an off schedule is explained', () => {
    expect(windowLabel({ startAt, endAt }, endAt + 60_000)).toBe(`ended ${at(endAt)}`);
  });

  it('shows nothing for a schedule without a window (and for older summaries)', () => {
    expect(windowLabel({ startAt: null, endAt: null }, before)).toBeNull();
    expect(windowLabel({}, before)).toBeNull();
  });
});

describe('scheduleWhen', () => {
  const summary = (over: Partial<ScheduleSummary>): ScheduleSummary => ({
    id: 'id', name: 'book-night', enabled: true, cron: '*/30 * * * *', runAt: null,
    timeZone: null, channel: null, model: null, promptPreview: '', source: 'manual',
    skillName: null, workflowName: null, createdAt: before, lastRunAt: null,
    lastResult: null, lastError: null, nextFireAt: null, nextFireIso: null, ...over,
  });

  it('puts the trigger on the first line and the window, then the next fire, under it', () => {
    expect(scheduleWhen(summary({ startAt, endAt, nextFireAt: startAt }), before)).toEqual({
      trigger: 'cron */30 * * * *',
      detail: `${at(startAt)} → ${at(endAt)} · next ${atFull(startAt)}`,
      full: `cron */30 * * * * · ${at(startAt)} → ${at(endAt)} · next ${atFull(startAt)}`,
    });
  });

  it('explains why a finished window schedule is off', () => {
    expect(scheduleWhen(summary({ startAt, endAt, enabled: false }), endAt + 60_000).detail).toBe(
      `ended ${at(endAt)}`,
    );
  });

  it('keeps the next fire of a schedule without a window on the second line', () => {
    expect(scheduleWhen(summary({ nextFireAt: startAt }), before)).toEqual({
      trigger: 'cron */30 * * * *',
      detail: `next ${atFull(startAt)}`,
      full: `cron */30 * * * * · next ${atFull(startAt)}`,
    });
  });

  it('has no second line when there is nothing more to say', () => {
    expect(scheduleWhen(summary({ enabled: false }), before).detail).toBeNull();
  });
});
