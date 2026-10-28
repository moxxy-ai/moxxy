/**
 * Authoring rules for a schedule's time window (`startAt` / `endAt`), shared by
 * every place a person or the model creates a schedule — the `schedule_create`
 * tool and `moxxy schedule add` — so both accept and refuse the same windows.
 */

export interface ScheduleWindowDraft {
  readonly cron?: string | undefined;
  readonly startAt?: number | undefined;
  readonly endAt?: number | undefined;
}

/** How the caller names the fields in its messages (tool fields or CLI flags). */
export interface ScheduleWindowFieldNames {
  readonly cron: string;
  readonly startAt: string;
  readonly endAt: string;
}

const TOOL_FIELD_NAMES: ScheduleWindowFieldNames = {
  cron: '`cron`',
  startAt: '`startAt`',
  endAt: '`endAt`',
};

/** The problem with a window's shape, or null when it is fine (or absent). */
export function windowShapeProblem(
  draft: ScheduleWindowDraft,
  names: ScheduleWindowFieldNames = TOOL_FIELD_NAMES,
): string | null {
  if (draft.startAt === undefined && draft.endAt === undefined) return null;
  if (draft.cron === undefined) return `${names.startAt} and ${names.endAt} only work with ${names.cron}`;
  if (draft.startAt !== undefined && draft.endAt !== undefined && draft.endAt <= draft.startAt) {
    return `${names.endAt} must be later than ${names.startAt}`;
  }
  return null;
}

/** The problem with a window that is already over at `now`, or null. */
export function windowEndedProblem(endAt: number | undefined, now: number): string | null {
  if (endAt === undefined || endAt > now) return null;
  return `this time window already ended at ${new Date(endAt).toISOString()}`;
}
