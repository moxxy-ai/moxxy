/**
 * A cron in plain words, for the repeats the New schedule form offers ("Every
 * 30 minutes", "On weekdays at 08:30"). Any other cron returns null, and the
 * caller shows the expression itself rather than a guess.
 */

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** A time of day in the person's own clock format. */
export function clockLabel(hour: number, minute: number): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const NUMBER = /^\d{1,2}$/;
const STEP = /^\*\/(\d{1,2})$/;

export function cronInWords(cron: string): string | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute = '', hour = '', day = '', month = '', weekday = ''] = fields;
  if (day !== '*' || month !== '*') return null;

  if (hour === '*' && weekday === '*') {
    if (minute === '*') return 'Every minute';
    const step = STEP.exec(minute)?.[1];
    if (step) return step === '1' ? 'Every minute' : `Every ${Number(step)} minutes`;
    return minute === '0' ? 'Every hour' : null;
  }
  if (minute === '0' && weekday === '*') {
    const step = STEP.exec(hour)?.[1];
    if (step) return step === '1' ? 'Every hour' : `Every ${Number(step)} hours`;
  }
  if (!NUMBER.test(minute) || !NUMBER.test(hour)) return null;
  const at = clockLabel(Number(hour), Number(minute));
  if (weekday === '*') return `Every day at ${at}`;
  if (weekday === '1-5') return `On weekdays at ${at}`;
  if (/^[0-7]$/.test(weekday)) return `Every ${WEEKDAY_NAMES[Number(weekday) % 7]} at ${at}`;
  return null;
}
