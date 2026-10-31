import { describe, expect, it } from 'vitest';
import { clockLabel, cronInWords } from './cron-words';

describe('cronInWords', () => {
  it('says the repeats the New schedule form offers in plain words', () => {
    expect(cronInWords('* * * * *')).toBe('Every minute');
    expect(cronInWords('*/30 * * * *')).toBe('Every 30 minutes');
    expect(cronInWords('0 * * * *')).toBe('Every hour');
    expect(cronInWords('0 */6 * * *')).toBe('Every 6 hours');
    expect(cronInWords('30 9 * * *')).toBe(`Every day at ${clockLabel(9, 30)}`);
    expect(cronInWords('0 8 * * 1-5')).toBe(`On weekdays at ${clockLabel(8, 0)}`);
    expect(cronInWords('15 18 * * 5')).toBe(`Every Friday at ${clockLabel(18, 15)}`);
    expect(cronInWords('0 7 * * 0')).toBe(`Every Sunday at ${clockLabel(7, 0)}`);
  });

  it('leaves a cron it has no words for to the caller', () => {
    expect(cronInWords('0 9 1 * *')).toBeNull();
    expect(cronInWords('5,35 * * * *')).toBeNull();
    expect(cronInWords('not a cron')).toBeNull();
  });
});
