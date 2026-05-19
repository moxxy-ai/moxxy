import { nextFireTime } from '@moxxy/plugin-scheduler';
import type { ScheduleEntry } from '@moxxy/plugin-scheduler';
import type { ParsedArgv } from '../../argv.js';

export function fmtNext(entry: ScheduleEntry): string {
  if (entry.cron) {
    const since = entry.lastRunAt ?? entry.createdAt;
    const next = nextFireTime(entry.cron, new Date(since), entry.timeZone);
    return next ? next.toISOString() : '(never — invalid)';
  }
  if (entry.runAt && entry.enabled) return new Date(entry.runAt).toISOString();
  return '(done)';
}

export function flag(argv: ParsedArgv, key: string): string | undefined {
  const v = argv.flags[key];
  return typeof v === 'string' ? v : undefined;
}
