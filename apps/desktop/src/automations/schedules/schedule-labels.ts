import type { ScheduleSummary } from '@moxxy/desktop-ipc-contract';
import { cronInWords } from './cron-words';

// Short date and time, no seconds: two of them have to fit one line.
const at = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

/**
 * The time window of a schedule as one short label: "start → end", "until end",
 * "from start", or "ended end" once it is over (which is also why the schedule
 * is off). Null when the schedule has no window.
 */
export function windowLabel(
  s: Pick<ScheduleSummary, 'startAt' | 'endAt'>,
  now: number,
): string | null {
  const { startAt, endAt } = s;
  if (endAt != null && endAt < now) return `ended ${at(endAt)}`;
  if (startAt != null && endAt != null) return `${at(startAt)} → ${at(endAt)}`;
  if (endAt != null) return `until ${at(endAt)}`;
  if (startAt != null) return `from ${at(startAt)}`;
  return null;
}

/** What sets a schedule off, in words where the form's repeats allow. */
export function whenLabel(s: ScheduleSummary): string {
  if (s.cron) {
    const zone = s.timeZone ? ` (${s.timeZone})` : '';
    return `${cronInWords(s.cron) ?? `Cron ${s.cron}`}${zone}`;
  }
  if (s.runAt) return `Once, ${at(s.runAt)}`;
  return 'On demand';
}

/** When the soonest schedule that is on runs next, or null when none is planned. */
export function soonestFireAt(list: ReadonlyArray<Pick<ScheduleSummary, 'enabled' | 'nextFireAt'>>): number | null {
  let soonest: number | null = null;
  for (const s of list) {
    if (s.enabled && s.nextFireAt !== null && (soonest === null || s.nextFireAt < soonest)) soonest = s.nextFireAt;
  }
  return soonest;
}

/**
 * How long until the soonest run, for the sentence "Next run: …". A run whose
 * moment came says "starting now" until the list is read again after it fired.
 */
export function nextFireSummary(list: ReadonlyArray<ScheduleSummary>, now: number = Date.now()): string {
  const soonest = soonestFireAt(list);
  if (soonest === null) return 'none planned';
  const mins = Math.round((soonest - now) / 60_000);
  if (mins <= 0) return 'starting now';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `in ${hours}h ${mins % 60}m` : `in ${Math.floor(hours / 24)}d`;
}

function nextLabel(s: ScheduleSummary): string | null {
  return s.enabled && s.nextFireAt ? `next ${at(s.nextFireAt)}` : null;
}

function lastLabel(s: ScheduleSummary): string | null {
  if (s.lastResult === 'error') return 'last run failed';
  if (s.lastResult === 'cancelled') return 'last run cancelled';
  return s.lastResult === 'ok' && s.lastRunAt ? `last run ${at(s.lastRunAt)}` : null;
}

function originLabel(s: ScheduleSummary): string | null {
  if (s.source === 'workflow') return `From workflow · ${s.workflowName ?? 'unknown'}`;
  if (s.source === 'skill') return `From skill · ${s.skillName ?? 'unknown'}`;
  return null;
}

function skippedLabel(s: ScheduleSummary): string | null {
  if (s.lastSkippedAt == null) return null;
  return `Skipped occurrence · ${at(s.lastSkippedAt)}${s.lastSkipReason ? ` · ${s.lastSkipReason}` : ''}`;
}

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Everything a schedule's row says, worked out from its summary. */
export interface ScheduleRowView {
  /** What sets it off: "Every 30 minutes", "Once, 29 Oct 2026, 08:00". */
  readonly trigger: string;
  /** Its window, next run and last run on one line, or null when there is none. */
  readonly detail: string | null;
  /** The last occurrence it skipped, and why. */
  readonly skipped: string | null;
  /** Where a schedule the person does not own comes from (a workflow, a skill). */
  readonly origin: string | null;
  readonly failing: boolean;
  /** Everything on one line, with the last error, for the hover title. */
  readonly full: string;
}

export function scheduleRowView(s: ScheduleSummary, now: number): ScheduleRowView {
  const trigger = whenLabel(s);
  const parts = [windowLabel(s, now), nextLabel(s), lastLabel(s)].filter((p): p is string => p !== null);
  const detail = parts.length > 0 ? upperFirst(parts.join(' · ')) : null;
  const failing = s.lastResult === 'error';
  return {
    trigger,
    detail,
    skipped: skippedLabel(s),
    origin: originLabel(s),
    failing,
    full: [trigger, detail, failing ? s.lastError : null].filter(Boolean).join(' · '),
  };
}
