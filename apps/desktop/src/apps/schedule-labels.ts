import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';

/**
 * The time window of a schedule as one short label: "start → end", "until end",
 * "from start", or "ended end" once it is over (which is also why the schedule
 * is off). Null when the schedule has no window.
 */
export function windowLabel(
  s: Pick<ScheduleSummary, 'startAt' | 'endAt'>,
  now: number,
): string | null {
  // Short date and time, no seconds: two of them have to fit one table line.
  const at = (ms: number): string =>
    new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  const { startAt, endAt } = s;
  if (endAt != null && endAt < now) return `ended ${at(endAt)}`;
  if (startAt != null && endAt != null) return `${at(startAt)} → ${at(endAt)}`;
  if (endAt != null) return `until ${at(endAt)}`;
  if (startAt != null) return `from ${at(startAt)}`;
  return null;
}

export function whenLabel(s: ScheduleSummary): string {
  if (s.cron) return `cron ${s.cron}${s.timeZone ? ` (${s.timeZone})` : ''}`;
  if (s.runAt) return `once @ ${new Date(s.runAt).toLocaleString()}`;
  return 'on demand';
}

/** The soonest upcoming fire across all enabled schedules, or nothing when none
 *  is pending. Measured from `nextFireAt`, which the scheduler already reports. */
export function nextFireSummary(list: ReadonlyArray<ScheduleSummary>): string {
  const times = list
    .filter((s) => s.enabled && s.nextFireAt !== null)
    .map((s) => s.nextFireAt as number)
    .sort((a, b) => a - b);
  const soonest = times[0];
  if (soonest === undefined) return 'None pending';
  const mins = Math.round((soonest - Date.now()) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `in ${hours}h ${mins % 60}m` : `in ${Math.floor(hours / 24)}d`;
}

export function nextLabel(s: ScheduleSummary): string | null {
  if (!s.enabled) return null;
  if (s.nextFireAt) return `next ${new Date(s.nextFireAt).toLocaleString()}`;
  return null;
}

/** The "When" cell: the trigger on top, then the time window and next fire. */
export interface ScheduleWhen {
  readonly trigger: string;
  /** Second line, or null when there is nothing beyond the trigger. */
  readonly detail: string | null;
  /** Everything on one line, for the hover title when a line is cut. */
  readonly full: string;
}

export function scheduleWhen(s: ScheduleSummary, now: number): ScheduleWhen {
  const trigger = whenLabel(s);
  const detail = [windowLabel(s, now), nextLabel(s)].filter(Boolean).join(' · ') || null;
  return { trigger, detail, full: detail ? `${trigger} · ${detail}` : trigger };
}
