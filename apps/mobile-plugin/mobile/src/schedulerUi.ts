export type MobileScheduleSource = 'manual' | 'skill' | 'workflow' | 'unknown';

export interface MobileSchedule {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly statusLabel: 'Enabled' | 'Disabled';
  readonly cron: string | null;
  readonly runAt: number | null;
  readonly timeZone: string | null;
  readonly promptPreview: string;
  readonly source: MobileScheduleSource;
  readonly sourceLabel: string;
  readonly ownerLabel: string | null;
  readonly timingLabel: string;
  readonly nextFireLabel: string | null;
  readonly outcomeLabel: string;
  readonly lastError: string | null;
}

export function normalizeScheduleForMobile(
  value: Record<string, unknown>,
  index: number,
): MobileSchedule {
  const source = normalizeSource(value.source);
  const cron = textOrNull(value.cron);
  const runAt = numberOrNull(value.runAt);
  const timeZone = textOrNull(value.timeZone);
  const nextFireIso = textOrNull(value.nextFireIso);
  const lastResult = textOrNull(value.lastResult);
  const ownerLabel = ownerLabelFor(source, value);
  return {
    id: textOf(value.id, `schedule-${index + 1}`),
    name: textOf(value.name, `Schedule ${index + 1}`),
    enabled: value.enabled === true,
    statusLabel: value.enabled === true ? 'Enabled' : 'Disabled',
    cron,
    runAt,
    timeZone,
    promptPreview: textOf(value.promptPreview, ''),
    source,
    sourceLabel: sourceLabelFor(source),
    ownerLabel,
    timingLabel: formatScheduleTiming({ cron, runAt, timeZone }),
    nextFireLabel: nextFireIso ? `Next ${formatDateTime(nextFireIso)}` : null,
    outcomeLabel: outcomeLabelFor(lastResult, textOrNull(value.lastRunAt)),
    lastError: textOrNull(value.lastError),
  };
}

export function formatScheduleTiming(input: {
  readonly cron: string | null;
  readonly runAt: number | null;
  readonly timeZone: string | null;
}): string {
  if (input.cron) return `Cron ${input.cron}`;
  if (input.runAt) return `One-shot ${formatDateTime(input.runAt)}`;
  return 'No trigger';
}

export function buildScheduleAccessibilityLabel(schedule: MobileSchedule): string {
  return [
    schedule.name,
    schedule.statusLabel,
    schedule.sourceLabel,
    schedule.timingLabel,
  ].filter(Boolean).join(', ');
}

function normalizeSource(value: unknown): MobileScheduleSource {
  return value === 'manual' || value === 'skill' || value === 'workflow' ? value : 'unknown';
}

function sourceLabelFor(source: MobileScheduleSource): string {
  if (source === 'manual') return 'Manual';
  if (source === 'skill') return 'Skill';
  if (source === 'workflow') return 'Workflow';
  return 'Scheduler';
}

function ownerLabelFor(source: MobileScheduleSource, value: Record<string, unknown>): string | null {
  if (source === 'skill') return textOrNull(value.skillName);
  if (source === 'workflow') return textOrNull(value.workflowName);
  return null;
}

function outcomeLabelFor(lastResult: string | null, lastRunAt: string | null): string {
  if (lastResult === 'ok') return 'Last run ok';
  if (lastResult === 'error') return 'Last run failed';
  return lastRunAt ? 'Last run recorded' : 'Not run yet';
}

function formatDateTime(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
