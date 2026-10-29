import { describe, expect, it } from 'vitest';
import { scheduleDraftProblem, type ScheduleDraft } from './draft.js';

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
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now - 60_000 }), now)).toMatch(/already passed/);
  });

  it('applies the time window rules', () => {
    expect(scheduleDraftProblem(draft({ cron: undefined, runAt: now + HOUR, endAt: now + 2 * HOUR }), now)).toMatch(
      /only work with/,
    );
    expect(scheduleDraftProblem(draft({ startAt: now + 2 * HOUR, endAt: now + HOUR }), now)).toMatch(/later than/);
    expect(scheduleDraftProblem(draft({ endAt: now - HOUR }), now)).toMatch(/already ended/);
  });
});
