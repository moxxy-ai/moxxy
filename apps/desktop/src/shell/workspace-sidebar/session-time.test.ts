import { describe, expect, it } from 'vitest';
import { formatSessionTime } from './session-time';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatSessionTime', () => {
  it('reads as a messenger does: now, minutes, hours, days', () => {
    expect(formatSessionTime(ago(20_000), NOW)).toBe('now');
    expect(formatSessionTime(ago(4 * MIN), NOW)).toBe('4m');
    expect(formatSessionTime(ago(2 * HOUR), NOW)).toBe('2h');
    expect(formatSessionTime(ago(3 * DAY), NOW)).toBe('3d');
  });

  it('switches to a date after a week, when a count of days stops meaning anything', () => {
    expect(formatSessionTime('2026-09-12T12:00:00Z', NOW)).toBe('Sep 12');
  });

  it('says nothing rather than inventing a time', () => {
    expect(formatSessionTime(undefined, NOW)).toBeNull();
    expect(formatSessionTime('not a date', NOW)).toBeNull();
  });

  it('treats a clock that ran ahead as now', () => {
    expect(formatSessionTime(ago(-5 * MIN), NOW)).toBe('now');
  });
});
