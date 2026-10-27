import { describe, expect, it } from 'vitest';
import { dueWakeup, wakeupsOf } from './scheduled-wakeups.js';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 24, h, m, s).getTime();

describe("Claude's crons as scheduled wakeups", () => {
  it('reads a one-shot wakeup as the time it comes back, in this computer\'s time', () => {
    const [wakeup] = wakeupsOf([{ id: 'c1', schedule: '59 22 24 10 *', recurring: false, prompt: 'check CI' }], at(22, 57, 35));
    expect(wakeup).toEqual({ id: 'c1', prompt: 'check CI', dueAtMs: at(22, 59), recurring: false });
  });

  it('keeps a wakeup firing this minute at now, not a year on', () => {
    const [wakeup] = wakeupsOf([{ id: 'c1', schedule: '59 22 24 10 *', recurring: false, prompt: 'check CI' }], at(22, 59, 2));
    expect(wakeup?.dueAtMs).toBe(at(22, 59));
  });

  it('reads a recurring one as its next fire', () => {
    const [wakeup] = wakeupsOf([{ id: 'c2', schedule: '*/5 * * * *', recurring: true, prompt: 'poll' }], at(10, 1, 30));
    expect(wakeup).toMatchObject({ dueAtMs: at(10, 5), recurring: true });
  });

  it('says nothing of the time for a schedule it cannot read', () => {
    expect(wakeupsOf([{ id: 'c3', schedule: 'soon', recurring: false, prompt: 'x' }], at(10, 0))[0]?.dueAtMs).toBeNull();
  });

  it('names a /loop wakeup by what it does, without the command', () => {
    expect(wakeupsOf([{ id: 'c4', schedule: '0 11 24 10 *', recurring: false, prompt: '/loop Check CI on main' }], at(10, 0))[0]?.prompt).toBe('Check CI on main');
  });

  it('finds the wakeup coming back now, and none that is still ahead', () => {
    const wakeups = wakeupsOf(
      [
        { id: 'now', schedule: '59 22 24 10 *', recurring: false, prompt: 'a' },
        { id: 'later', schedule: '30 23 24 10 *', recurring: false, prompt: 'b' },
      ],
      at(22, 58),
    );
    expect(dueWakeup(wakeups, at(22, 59, 1))?.id).toBe('now');
    expect(dueWakeup(wakeups, at(22, 58, 30))).toBeUndefined();
  });
});
