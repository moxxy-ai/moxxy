import { describe, expect, it } from 'vitest';
import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { clockLabel } from './cron-words';
import { nextFireSummary, scheduleRowView, soonestFireAt, windowLabel } from './schedule-labels';

const startAt = new Date(2026, 9, 29, 23, 0).getTime();
const endAt = new Date(2026, 9, 30, 7, 0).getTime();
const before = new Date(2026, 9, 28, 18, 0).getTime();
const at = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

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

describe('scheduleRowView', () => {
  const summary = (over: Partial<ScheduleSummary>): ScheduleSummary => ({
    id: 'id', name: 'book-night', enabled: true, cron: '*/30 * * * *', runAt: null,
    timeZone: null, channel: null, model: null, promptPreview: '', source: 'manual',
    skillName: null, workflowName: null, createdAt: before, lastRunAt: null,
    lastResult: null, lastError: null, nextFireAt: null, nextFireIso: null, ...over,
  });

  it('says the repeat in words, with the window and the next run under it', () => {
    const view = scheduleRowView(summary({ startAt, endAt, nextFireAt: startAt }), before);
    expect(view.trigger).toBe('Every 30 minutes');
    expect(view.detail).toBe(`${at(startAt)} → ${at(endAt)} · next ${at(startAt)}`);
    expect(view.full).toBe(`Every 30 minutes · ${view.detail}`);
    expect(view.failing).toBe(false);
    expect(view.origin).toBeNull();
  });

  it('shows a cron it has no words for as the cron, with its time zone', () => {
    expect(scheduleRowView(summary({ cron: '0 9 1 * *', timeZone: 'Europe/Warsaw' }), before).trigger).toBe(
      'Cron 0 9 1 * * (Europe/Warsaw)',
    );
    expect(scheduleRowView(summary({ cron: '0 9 * * 1-5' }), before).trigger).toBe(`On weekdays at ${clockLabel(9, 0)}`);
  });

  it('says when a one-shot runs', () => {
    expect(scheduleRowView(summary({ cron: null, runAt: startAt }), before).trigger).toBe(`Once, ${at(startAt)}`);
  });

  it('explains why a finished window schedule is off', () => {
    expect(scheduleRowView(summary({ startAt, endAt, enabled: false }), endAt + 60_000).detail).toBe(
      `Ended ${at(endAt)}`,
    );
  });

  it('says how the last run went, and why it failed on hover', () => {
    const ok = scheduleRowView(summary({ lastResult: 'ok', lastRunAt: before }), before);
    expect(ok.detail).toBe(`Last run ${at(before)}`);
    const failed = scheduleRowView(summary({ lastResult: 'error', lastRunAt: before, lastError: 'provider down' }), before);
    expect(failed.failing).toBe(true);
    expect(failed.detail).toBe('Last run failed');
    expect(failed.full).toBe('Every 30 minutes · Last run failed · provider down');
  });

  it('has no second line when there is nothing more to say', () => {
    expect(scheduleRowView(summary({ enabled: false }), before).detail).toBeNull();
  });

  it('names where a schedule it does not own comes from, and a skipped occurrence apart from the last result', () => {
    const view = scheduleRowView(
      summary({
        source: 'workflow',
        workflowName: 'Daily report',
        lastResult: 'ok',
        lastRunAt: before,
        lastSkippedAt: startAt,
        lastSkipReason: 'Previous workflow execution is still running or awaiting approval',
      }),
      before,
    );
    expect(view.origin).toBe('From workflow · Daily report');
    expect(view.detail).toBe(`Last run ${at(before)}`);
    expect(view.skipped).toBe(
      `Skipped occurrence · ${at(startAt)} · Previous workflow execution is still running or awaiting approval`,
    );
    expect(scheduleRowView(summary({ source: 'skill', skillName: 'digest' }), before).origin).toBe('From skill · digest');
  });

  it('does not invent skipped occurrences for older schedule summaries', () => {
    expect(scheduleRowView(summary({}), before).skipped).toBeNull();
  });
});

describe('nextFireSummary', () => {
  const now = new Date(2026, 9, 29, 12, 0).getTime();
  const pending = (nextFireAt: number | null, enabled = true) =>
    ({ enabled, nextFireAt }) as ScheduleSummary;

  it('counts down to the soonest run of a schedule that is on', () => {
    const list = [pending(now + 90 * 60_000), pending(now + 5 * 60_000, false), pending(now + 12 * 60_000)];
    expect(soonestFireAt(list)).toBe(now + 12 * 60_000);
    expect(nextFireSummary(list, now)).toBe('in 12m');
    expect(nextFireSummary([pending(now + 26 * 3_600_000)], now)).toBe('in 1d');
  });

  it('says a run is starting, not that it is "due", once its time came', () => {
    expect(nextFireSummary([pending(now - 20_000)], now)).toBe('starting now');
    expect(nextFireSummary([pending(now + 10_000)], now)).toBe('starting now');
  });

  it('says nothing is planned, in the same case as the sentence it sits in', () => {
    expect(soonestFireAt([pending(null)])).toBeNull();
    expect(nextFireSummary([pending(null), pending(now + 60_000, false)], now)).toBe('none planned');
  });
});
