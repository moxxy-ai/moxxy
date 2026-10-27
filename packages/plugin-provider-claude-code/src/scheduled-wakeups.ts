import type { AgentScheduledWakeup } from '@moxxy/sdk';
import { nextFireTime } from '@moxxy/sdk/cron';
import type { ClaudeSessionCron } from './sdk-types.js';

/** How long after its fire time Claude may take up the turn for a wakeup, and how early. */
const LATE_MS = 60_000;
const EARLY_MS = 5_000;

/**
 * Claude's crons as Moxxy shows them: when each comes back next, read from its
 * schedule in this computer's time (Claude's crons run in local time).
 */
export function wakeupsOf(crons: ReadonlyArray<ClaudeSessionCron>, nowMs: number): AgentScheduledWakeup[] {
  return crons.map((cron) => ({
    id: cron.id,
    prompt: cron.prompt.replace(/^\/loop\s+/, ''),
    dueAtMs: dueAt(cron.schedule, nowMs),
    recurring: cron.recurring,
  }));
}

/** The wakeup Claude comes back for now, if one is due. */
export function dueWakeup(wakeups: ReadonlyArray<AgentScheduledWakeup>, nowMs: number): AgentScheduledWakeup | undefined {
  return wakeups.find((wakeup) => wakeup.dueAtMs !== null && wakeup.dueAtMs <= nowMs + EARLY_MS && wakeup.dueAtMs >= nowMs - LATE_MS);
}

function dueAt(schedule: string, nowMs: number): number | null {
  try {
    // From a minute back, so a one-shot wakeup firing this minute reads as now, not as next year.
    return nextFireTime(schedule, new Date(nowMs - 60_000))?.getTime() ?? null;
  } catch {
    return null;
  }
}
