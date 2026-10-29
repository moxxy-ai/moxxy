import { describe, expect, it } from 'vitest';
import { clockLabel } from './cron-words';
import {
  cleanNameInput,
  initialScheduleForm,
  scheduleCron,
  scheduleFormProblems,
  scheduleFormSummary,
  slugifyScheduleName,
  toScheduleCreateInput,
  type ScheduleFormValues,
} from './schedule-form';

const now = new Date(2026, 9, 28, 18, 34).getTime();
const at = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime();

function form(over: Partial<ScheduleFormValues> = {}): ScheduleFormValues {
  return { ...initialScheduleForm(now), prompt: 'Continue the book', name: 'continue-the-book', ...over };
}

describe('initialScheduleForm', () => {
  it('starts on a valid repeat with sensible times, so only the prompt is left to fill', () => {
    const v = initialScheduleForm(now);
    expect(v.repeat).toBe('daily');
    expect(v.time).toBe('09:00');
    expect(v.at).toBe('2026-10-28T19:00');
    expect(v.from).toBe('2026-10-28T19:00');
    expect(v.until).toBe('2026-10-29T03:00');
    expect(v.limitWindow).toBe(false);
    expect(scheduleFormProblems({ ...v, prompt: 'x', name: 'x' }, now)).toEqual({});
  });
});

describe('names', () => {
  it('makes a slug out of what the person wrote', () => {
    expect(slugifyScheduleName('Summarise my unread e-mail, then send it to Telegram')).toBe(
      'summarise-my-unread-e-mail-then',
    );
    expect(slugifyScheduleName('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(slugifyScheduleName('  !!  ')).toBe('');
  });

  it('keeps a typed name valid as it is typed, without eating the hyphen being typed', () => {
    expect(cleanNameInput('Morning News')).toBe('morning-news');
    expect(cleanNameInput('morning-')).toBe('morning-');
    expect(cleanNameInput('-a  b')).toBe('a-b');
  });
});

describe('scheduleCron', () => {
  it('turns each repeat into its cron', () => {
    expect(scheduleCron(form({ repeat: 'once' }))).toBeNull();
    expect(scheduleCron(form({ repeat: 'minutes', everyMinutes: 30 }))).toBe('*/30 * * * *');
    expect(scheduleCron(form({ repeat: 'hours', everyHours: 1 }))).toBe('0 * * * *');
    expect(scheduleCron(form({ repeat: 'hours', everyHours: 4 }))).toBe('0 */4 * * *');
    expect(scheduleCron(form({ repeat: 'daily', time: '07:05' }))).toBe('5 7 * * *');
    expect(scheduleCron(form({ repeat: 'weekdays', time: '08:30' }))).toBe('30 8 * * 1-5');
    expect(scheduleCron(form({ repeat: 'weekly', weekday: 1, time: '09:00' }))).toBe('0 9 * * 1');
    expect(scheduleCron(form({ repeat: 'custom', cron: '  0 9 1 * * ' }))).toBe('0 9 1 * *');
  });
});

describe('scheduleFormProblems', () => {
  it('asks for what is missing, in words', () => {
    expect(scheduleFormProblems(form({ prompt: ' ', name: '' }), now)).toEqual({
      prompt: 'Say what Moxxy should do.',
      name: 'Give it a name.',
    });
  });

  it('refuses a one-shot moment in the past', () => {
    expect(scheduleFormProblems(form({ repeat: 'once', at: '2026-10-28T18:00' }), now)).toEqual({
      at: 'This time has already passed.',
    });
    expect(scheduleFormProblems(form({ repeat: 'once', at: '' }), now)).toEqual({ at: 'Pick a date and time.' });
  });

  it('wants five parts in a custom cron', () => {
    expect(scheduleFormProblems(form({ repeat: 'custom', cron: '0 9 * *' }), now)).toEqual({
      cron: 'A cron has five parts: minute, hour, day, month, weekday.',
    });
  });

  it('checks the time window only when it is switched on', () => {
    const late = { from: '2026-10-27T23:00', until: '2026-10-28T07:00' };
    expect(scheduleFormProblems(form(late), now)).toEqual({});
    expect(scheduleFormProblems(form({ ...late, limitWindow: true }), now)).toEqual({
      until: 'This window has already ended.',
    });
    expect(
      scheduleFormProblems(
        form({ limitWindow: true, from: '2026-10-29T07:00', until: '2026-10-29T07:00' }),
        now,
      ),
    ).toEqual({ until: 'The end must be after the start.' });
  });

  it('never offers a window to a one-shot', () => {
    expect(
      scheduleFormProblems(form({ repeat: 'once', limitWindow: true, until: '2026-10-01T00:00' }), now),
    ).toEqual({});
  });
});

describe('toScheduleCreateInput', () => {
  it('sends a repeat limited to a window as cron + startAt/endAt', () => {
    const v = form({
      repeat: 'minutes',
      everyMinutes: 30,
      limitWindow: true,
      from: '2026-10-29T23:00',
      until: '2026-10-30T07:00',
      targetSessionId: 'desk-1',
    });
    expect(toScheduleCreateInput(v)).toEqual({
      name: 'continue-the-book',
      prompt: 'Continue the book',
      cron: '*/30 * * * *',
      startAt: local(2026, 9, 29, 23, 0),
      endAt: local(2026, 9, 30, 7, 0),
      targetSessionId: 'desk-1',
    });
  });

  it('sends a one-shot as runAt, never with a window', () => {
    expect(
      toScheduleCreateInput(form({ repeat: 'once', at: '2026-10-29T08:00', limitWindow: true, name: 'wake-' })),
    ).toEqual({ name: 'wake', prompt: 'Continue the book', runAt: local(2026, 9, 29, 8, 0) });
  });
});

describe('scheduleFormSummary', () => {
  it('says in one sentence what will happen', () => {
    expect(scheduleFormSummary(form({ repeat: 'weekdays', time: '08:30' }))).toBe(
      `Runs on weekdays at ${clockLabel(8, 30)}.`,
    );
    expect(scheduleFormSummary(form({ repeat: 'once', at: '2026-10-29T08:00' }))).toBe(
      `Runs once, ${at(local(2026, 9, 29, 8, 0))}.`,
    );
    expect(
      scheduleFormSummary(
        form({ repeat: 'minutes', everyMinutes: 30, limitWindow: true, from: '2026-10-29T23:00', until: '2026-10-30T07:00' }),
      ),
    ).toBe(
      `Runs every 30 minutes from ${at(local(2026, 9, 29, 23, 0))} until ${at(local(2026, 9, 30, 7, 0))}, then stops.`,
    );
  });

  it('falls back to the cron itself, and says nothing while it cannot', () => {
    expect(scheduleFormSummary(form({ repeat: 'custom', cron: '0 9 1 * *' }))).toBe('Runs on cron 0 9 1 * *.');
    expect(scheduleFormSummary(form({ repeat: 'custom', cron: '' }))).toBeNull();
    expect(scheduleFormSummary(form({ repeat: 'once', at: '' }))).toBeNull();
  });
});
