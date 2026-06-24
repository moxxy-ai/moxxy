// ---------- Scheduler ------------------------------------------------------

export type ScheduleSource = 'manual' | 'skill' | 'workflow';

export interface ScheduleSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly cron: string | null;
  readonly runAt: number | null;
  readonly timeZone: string | null;
  readonly channel: string | null;
  readonly model: string | null;
  readonly promptPreview: string;
  readonly source: ScheduleSource;
  readonly skillName: string | null;
  readonly workflowName: string | null;
  /** Session this schedule fires in (where its run runs + displays), or null
   *  when owner-less. Optional for back-compat with older summary producers. */
  readonly targetSessionId?: string | null;
  /** Resolved display name of `targetSessionId` (its session title), or null
   *  when owner-less or the bound session no longer exists. */
  readonly targetSessionName?: string | null;
  readonly createdAt: number;
  readonly lastRunAt: number | null;
  readonly lastResult: 'ok' | 'error' | null;
  readonly lastError: string | null;
  readonly nextFireAt: number | null;
  readonly nextFireIso: string | null;
}

export interface SchedulerDeleteResult {
  readonly deleted: boolean;
}
