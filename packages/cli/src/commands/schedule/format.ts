import { describeScheduleEntry } from '@moxxy/plugin-scheduler';
import type { ScheduleEntry } from '@moxxy/plugin-scheduler';
import type { ParsedArgv } from '../../argv.js';

export function fmtNext(entry: ScheduleEntry): string {
  if (entry.cron) {
    // Same next-fire as the poller, the desktop and the model see (it honours
    // the time window), instead of a second calculation that can disagree.
    const { nextFireIso } = describeScheduleEntry(entry);
    if (typeof nextFireIso === 'string') return nextFireIso;
    return entry.endAt !== undefined ? '(window ended)' : '(never — invalid)';
  }
  if (entry.runAt && entry.enabled) return new Date(entry.runAt).toISOString();
  return '(done)';
}

/** The time window of a cron schedule, e.g. ` from <iso> until <iso>`; '' when it has none. */
export function fmtWindow(entry: ScheduleEntry): string {
  const from = entry.startAt !== undefined ? ` from ${new Date(entry.startAt).toISOString()}` : '';
  const until = entry.endAt !== undefined ? ` until ${new Date(entry.endAt).toISOString()}` : '';
  return from + until;
}

export function flag(argv: ParsedArgv, key: string): string | undefined {
  const v = argv.flags[key];
  return typeof v === 'string' ? v : undefined;
}
