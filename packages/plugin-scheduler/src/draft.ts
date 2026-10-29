import { isValidCron, isValidTimeZone } from '@moxxy/sdk/cron';
import { windowEndedProblem, windowShapeProblem, type ScheduleWindowFieldNames } from './window.js';

/**
 * A schedule someone asked for, before it is saved. The single set of rules
 * every place that creates a schedule from outside (the `schedule_create` tool,
 * `moxxy schedule add`, the desktop's New schedule form) checks before calling
 * `ScheduleStore.create`.
 */
export interface ScheduleDraft {
  readonly name: string;
  readonly prompt: string;
  readonly cron?: string | undefined;
  readonly runAt?: number | undefined;
  readonly startAt?: number | undefined;
  readonly endAt?: number | undefined;
  readonly timeZone?: string | undefined;
}

/** How the caller names the fields in its messages (tool fields or CLI flags). */
export interface ScheduleDraftFieldNames extends ScheduleWindowFieldNames {
  readonly runAt: string;
  readonly timeZone: string;
}

const TOOL_FIELD_NAMES: ScheduleDraftFieldNames = {
  cron: '`cron`',
  runAt: '`runAt`',
  startAt: '`startAt`',
  endAt: '`endAt`',
  timeZone: 'timeZone',
};

/** Schedule names are slugs: they show up in inbox file names and the CLI. */
export const SCHEDULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
export const SCHEDULE_NAME_MAX = 120;

/**
 * How far back a one-shot moment still counts as "now". A run set for the
 * current minute reaches the store a few seconds late; the poller fires it on
 * its next tick, which is what the person meant.
 */
export const ONE_SHOT_GRACE_MS = 60_000;

/** The first thing wrong with the draft itself, whatever the time, or null. */
export function scheduleShapeProblem(
  draft: ScheduleDraft,
  names: ScheduleDraftFieldNames = TOOL_FIELD_NAMES,
): string | null {
  if (draft.name.length === 0) return 'name is required';
  if (draft.name.length > SCHEDULE_NAME_MAX) return `name must be at most ${SCHEDULE_NAME_MAX} characters`;
  if (!SCHEDULE_NAME_PATTERN.test(draft.name)) return 'name must be slug-like (letters, digits, hyphens)';
  if (draft.prompt.trim() === '') return 'prompt is required';
  if (draft.cron === undefined && draft.runAt === undefined) return `provide either ${names.cron} or ${names.runAt}`;
  if (draft.cron !== undefined && draft.runAt !== undefined) {
    return `provide either ${names.cron} or ${names.runAt}, not both`;
  }
  if (draft.cron !== undefined && !isValidCron(draft.cron)) return `invalid cron expression "${draft.cron}"`;
  if (draft.timeZone !== undefined && !isValidTimeZone(draft.timeZone)) {
    return `invalid ${names.timeZone} "${draft.timeZone}" (must be an IANA zone or "local")`;
  }
  return windowShapeProblem(draft, names);
}

/** What makes the draft never run because its time is over at `now`, or null. */
export function scheduleTimingProblem(draft: ScheduleDraft, now: number): string | null {
  if (draft.runAt !== undefined && draft.runAt < now - ONE_SHOT_GRACE_MS) {
    return `this moment already passed at ${new Date(draft.runAt).toISOString()}`;
  }
  return windowEndedProblem(draft.endAt, now);
}

/** The first problem with a draft at `now`, or null when it can be saved. */
export function scheduleDraftProblem(
  draft: ScheduleDraft,
  now: number,
  names: ScheduleDraftFieldNames = TOOL_FIELD_NAMES,
): string | null {
  return scheduleShapeProblem(draft, names) ?? scheduleTimingProblem(draft, now);
}
