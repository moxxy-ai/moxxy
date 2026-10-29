/**
 * The New schedule form's rules, kept apart from the form so they can be read
 * and tested on their own: which repeats it offers and the cron each one
 * becomes, what a field is missing, the sentence that says what will happen,
 * and the `scheduler.create` payload. The host checks the payload again with
 * the scheduler's own rules (`scheduleDraftProblem`).
 */

import type { ScheduleCreateInput } from '@moxxy/desktop-ipc-contract';
import { cronInWords } from './cron-words';

export type ScheduleRepeat = 'once' | 'minutes' | 'hours' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export const REPEAT_CHOICES: ReadonlyArray<{ readonly value: ScheduleRepeat; readonly label: string }> = [
  { value: 'once', label: 'Once' },
  { value: 'minutes', label: 'Every few minutes' },
  { value: 'hours', label: 'Every few hours' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'On weekdays' },
  { value: 'weekly', label: 'Every week' },
  { value: 'custom', label: 'Custom (cron)' },
];

/** Steps that divide the hour and the day evenly, so a cron step is exact. */
export const MINUTE_STEPS = [5, 10, 15, 20, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

export interface ScheduleFormValues {
  readonly prompt: string;
  readonly name: string;
  /** The person typed a name, so it no longer follows the prompt. */
  readonly nameEdited: boolean;
  readonly repeat: ScheduleRepeat;
  readonly everyMinutes: number;
  readonly everyHours: number;
  /** `HH:MM`, for every day / weekdays / every week. */
  readonly time: string;
  /** 0 = Sunday … 6 = Saturday, for every week. */
  readonly weekday: number;
  /** `YYYY-MM-DDTHH:MM` local, for once. */
  readonly at: string;
  readonly cron: string;
  /** Repeats only: run only between `from` and `until`, then stop. */
  readonly limitWindow: boolean;
  readonly from: string;
  readonly until: string;
  readonly targetSessionId: string | null;
}

export type ScheduleFormField = 'prompt' | 'name' | 'at' | 'time' | 'cron' | 'from' | 'until';
export type ScheduleFormProblems = Partial<Record<ScheduleFormField, string>>;

const HOUR_MS = 60 * 60_000;
const NAME_MAX = 120;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Epoch ms as the value of a `datetime-local` input. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value as epoch ms (local time), or null when unset. */
export function fromLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export function initialScheduleForm(now: number): ScheduleFormValues {
  const nextHour = Math.ceil((now + 1) / HOUR_MS) * HOUR_MS;
  return {
    prompt: '',
    name: '',
    nameEdited: false,
    repeat: 'daily',
    everyMinutes: 30,
    everyHours: 1,
    time: '09:00',
    weekday: 1,
    at: toLocalInput(nextHour),
    cron: '',
    limitWindow: false,
    from: toLocalInput(nextHour),
    until: toLocalInput(nextHour + 8 * HOUR_MS),
    targetSessionId: null,
  };
}

function plainLetters(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** A name made from the first words of the prompt. */
export function slugifyScheduleName(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 5).join(' ');
  return plainLetters(words)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** What the person types in the name field, kept a valid slug as they type. */
export function cleanNameInput(text: string): string {
  return plainLetters(text)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
}

const finalName = (name: string): string => name.replace(/-+$/, '');

/** The cron a repeating schedule becomes, or null for once. */
export function scheduleCron(v: ScheduleFormValues): string | null {
  const clock = parseClock(v.time);
  const at = clock ? `${clock.minute} ${clock.hour}` : '0 9';
  switch (v.repeat) {
    case 'once':
      return null;
    case 'minutes':
      return `*/${v.everyMinutes} * * * *`;
    case 'hours':
      return v.everyHours === 1 ? '0 * * * *' : `0 */${v.everyHours} * * *`;
    case 'daily':
      return `${at} * * *`;
    case 'weekdays':
      return `${at} * * 1-5`;
    case 'weekly':
      return `${at} * * ${v.weekday}`;
    case 'custom':
      return v.cron.trim().split(/\s+/).join(' ');
  }
}

const usesClock = (repeat: ScheduleRepeat): boolean =>
  repeat === 'daily' || repeat === 'weekdays' || repeat === 'weekly';

export function scheduleFormProblems(v: ScheduleFormValues, now: number): ScheduleFormProblems {
  const problems: ScheduleFormProblems = {};
  if (v.prompt.trim() === '') problems.prompt = 'Say what Moxxy should do.';
  const name = finalName(v.name);
  if (name === '') problems.name = 'Give it a name.';
  else if (name.length > NAME_MAX) problems.name = `Keep the name under ${NAME_MAX} characters.`;
  else if (!NAME_PATTERN.test(name)) problems.name = 'Use letters, digits and hyphens.';

  if (v.repeat === 'once') {
    const runAt = fromLocalInput(v.at);
    if (runAt === null) problems.at = 'Pick a date and time.';
    else if (runAt <= now) problems.at = 'This time has already passed.';
    return problems;
  }
  if (usesClock(v.repeat) && !parseClock(v.time)) problems.time = 'Pick a time.';
  if (v.repeat === 'custom') {
    const parts = v.cron.trim() === '' ? 0 : v.cron.trim().split(/\s+/).length;
    if (parts === 0) problems.cron = 'Enter a cron expression.';
    else if (parts !== 5) problems.cron = 'A cron has five parts: minute, hour, day, month, weekday.';
  }
  if (v.limitWindow) {
    const startAt = fromLocalInput(v.from);
    const endAt = fromLocalInput(v.until);
    if (startAt === null) problems.from = 'Pick when it starts.';
    if (endAt === null) problems.until = 'Pick when it stops.';
    else if (startAt !== null && endAt <= startAt) problems.until = 'The end must be after the start.';
    else if (endAt <= now) problems.until = 'This window has already ended.';
  }
  return problems;
}

export function toScheduleCreateInput(v: ScheduleFormValues): ScheduleCreateInput {
  const base = {
    name: finalName(v.name),
    prompt: v.prompt.trim(),
    ...(v.targetSessionId ? { targetSessionId: v.targetSessionId } : {}),
  };
  const cron = scheduleCron(v);
  if (cron === null) return { ...base, runAt: fromLocalInput(v.at) ?? 0 };
  const startAt = v.limitWindow ? fromLocalInput(v.from) : null;
  const endAt = v.limitWindow ? fromLocalInput(v.until) : null;
  return {
    ...base,
    cron,
    ...(startAt !== null ? { startAt } : {}),
    ...(endAt !== null ? { endAt } : {}),
  };
}

// Numbers only, as the list writes them: a month name would come in the
// system's language inside an English sentence.
const moment = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** One sentence on what will happen, or null while the form cannot say. */
export function scheduleFormSummary(v: ScheduleFormValues): string | null {
  const cron = scheduleCron(v);
  if (cron === null) {
    const runAt = fromLocalInput(v.at);
    return runAt === null ? null : `Runs once, ${moment(runAt)}.`;
  }
  if (cron === '') return null;
  const words = cronInWords(cron);
  const repeat = words ? lowerFirst(words) : `on cron ${cron}`;
  const startAt = v.limitWindow ? fromLocalInput(v.from) : null;
  const endAt = v.limitWindow ? fromLocalInput(v.until) : null;
  const window =
    startAt !== null && endAt !== null ? ` from ${moment(startAt)} until ${moment(endAt)}, then stops` : '';
  return `Runs ${repeat}${window}.`;
}
