import { isValidCron, isValidTimeZone } from '@moxxy/sdk/cron';
import { windowEndedProblem, windowShapeProblem } from './window.js';

/**
 * A schedule someone asked for, before it is saved. The single set of rules
 * every place that creates a schedule from outside (the `schedule_create` tool,
 * the desktop's New schedule form) checks before calling `ScheduleStore.create`.
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

/** Schedule names are slugs: they show up in inbox file names and the CLI. */
export const SCHEDULE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
export const SCHEDULE_NAME_MAX = 120;

/** The first problem with a draft at `now`, or null when it can be saved. */
export function scheduleDraftProblem(draft: ScheduleDraft, now: number): string | null {
  if (draft.name.length === 0) return 'name is required';
  if (draft.name.length > SCHEDULE_NAME_MAX) return `name must be at most ${SCHEDULE_NAME_MAX} characters`;
  if (!SCHEDULE_NAME_PATTERN.test(draft.name)) return 'name must be slug-like (letters, digits, hyphens)';
  if (draft.prompt.trim() === '') return 'prompt is required';
  if (draft.cron === undefined && draft.runAt === undefined) return 'provide either `cron` or `runAt`';
  if (draft.cron !== undefined && draft.runAt !== undefined) return 'provide either `cron` or `runAt`, not both';
  if (draft.cron !== undefined && !isValidCron(draft.cron)) return `invalid cron expression "${draft.cron}"`;
  if (draft.timeZone !== undefined && !isValidTimeZone(draft.timeZone)) {
    return `invalid timeZone "${draft.timeZone}" (must be an IANA zone or "local")`;
  }
  if (draft.runAt !== undefined && draft.runAt <= now) {
    return `this moment already passed at ${new Date(draft.runAt).toISOString()}`;
  }
  return windowShapeProblem(draft) ?? windowEndedProblem(draft.endAt, now);
}
