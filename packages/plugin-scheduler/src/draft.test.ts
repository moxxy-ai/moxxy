import { describe, expect, it } from 'vitest';
import { scheduleDraftProblem, scheduleShapeProblem, scheduleTimingProblem, type ScheduleDraft } from './draft.js';

const now = new Date(2026, 9, 28, 12, 0).getTime();
const HOUR = 60 * 60_000;
const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  name: 'morning-news',
  prompt: 'Summarise the news',
  cron: '0 9 * * *',
  ...over,
});

describe('scheduleDraftProblem', () => {
  it('accepts a recurring schedule, a one-shot and a recurring schedule with a window', () => {
    expect(scheduleDraftProblem(draft(), now)).toBeNull();
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now + HOUR }), now)).toBeNull();
    expect(
      scheduleDraftProblem(draft({ cron: '*/30 * * * *', startAt: now + HOUR, endAt: now + 8 * HOUR }), now),
    ).toBeNull();
  });

  it('refuses a window that no run of the cron falls inside', () => {
    const start = new Date(2026, 9, 28, 12, 7).getTime();
    expect(
      scheduleDraftProblem(draft({ cron: '*/5 * * * *', startAt: start, endAt: start + 2 * 60_000 }), now),
    ).toMatch(/no run/);
    // The same window, one minute longer, reaches 12:10.
    expect(
      scheduleDraftProblem(draft({ cron: '*/5 * * * *', startAt: start, endAt: start + 3 * 60_000 }), now),
    ).toBeNull();
  });

  it('looks for that run from now when the window opened earlier or has no start', () => {
    expect(scheduleDraftProblem(draft({ endAt: now + HOUR }), now)).toMatch(/no run/);
    expect(scheduleDraftProblem(draft({ startAt: now - 4 * HOUR, endAt: now + HOUR }), now)).toMatch(/no run/);
    expect(scheduleDraftProblem(draft({ endAt: now + 24 * HOUR }), now)).toBeNull();
  });

  it('reads that run in the time zone of the schedule', () => {
    // 09:00 in Tokyo is 00:00 UTC, and 09:00 UTC is hours away from it.
    const utcMidnight = Date.UTC(2026, 9, 28, 0, 0);
    const window = { startAt: utcMidnight - 60_000, endAt: utcMidnight + 60_000 };
    expect(scheduleDraftProblem(draft({ ...window, timeZone: 'Asia/Tokyo' }), utcMidnight - 2 * 60_000)).toBeNull();
    expect(scheduleDraftProblem(draft({ ...window, timeZone: 'UTC' }), utcMidnight - 2 * 60_000)).toMatch(/no run/);
  });

  it('needs a slug-like name', () => {
    expect(scheduleDraftProblem(draft({ name: '' }), now)).toMatch(/name/);
    expect(scheduleDraftProblem(draft({ name: 'Morning news!' }), now)).toMatch(/letters, digits, hyphens/);
    expect(scheduleDraftProblem(draft({ name: 'a'.repeat(121) }), now)).toMatch(/120/);
  });

  it('needs something to do', () => {
    expect(scheduleDraftProblem(draft({ prompt: '   ' }), now)).toMatch(/prompt/);
  });

  it('needs exactly one trigger', () => {
    expect(scheduleDraftProblem(draft({ cron: undefined }), now)).toMatch(/either/);
    expect(scheduleDraftProblem(draft({ runAt: now + HOUR }), now)).toMatch(/not both/);
  });

  it('refuses a cron it cannot read and an unknown time zone', () => {
    expect(scheduleDraftProblem(draft({ cron: 'every day' }), now)).toMatch(/invalid cron expression "every day"/);
    expect(scheduleDraftProblem(draft({ timeZone: 'Mars/Base' }), now)).toMatch(/invalid timeZone/);
  });

  it('refuses a one-shot moment that has already passed', () => {
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now - 5 * 60_000 }), now)).toMatch(/already passed/);
  });

  it('takes a moment from the last minute as "now", so a run set for right now is not refused', () => {
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now - 20_000 }), now)).toBeNull();
  });

  it('names the fields the way the caller does', () => {
    const cli = { cron: '--cron', runAt: '--at', startAt: '--from', endAt: '--until', timeZone: '--timezone' };
    expect(scheduleDraftProblem(draft({ timeZone: 'Mars/Base' }), now, cli)).toMatch(/invalid --timezone "Mars\/Base"/);
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now + 1, endAt: now + 2 }), now, cli)).toMatch(
      /--from and --until only work with --cron/,
    );
  });

  it('tells a time that passed apart from a draft that is wrong', () => {
    const ended = draft({ endAt: now - 1 });
    expect(scheduleShapeProblem(ended)).toBeNull();
    expect(scheduleTimingProblem(ended, now)).toMatch(/already ended/);
    expect(scheduleShapeProblem(draft({ cron: 'nope' }))).toMatch(/invalid cron/);
  });

  it('applies the time window rules', () => {
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now + HOUR, endAt: now + 2 * HOUR }), now)).toMatch(
      /only work with/,
    );
    expect(scheduleDraftProblem(draft({ startAt: now + 2 * HOUR, endAt: now + HOUR }), now)).toMatch(/later than/);
    expect(scheduleDraftProblem(draft({ endAt: now - HOUR }), now)).toMatch(/already ended/);
  });
});
