import { describe, expect, it } from 'vitest';
import {
  buildScheduleAccessibilityLabel,
  formatScheduleTiming,
  normalizeScheduleForMobile,
} from '../src/schedulerUi';

describe('mobile scheduler UI helpers', () => {
  it('normalizes scheduler entries into compact, stable mobile cards', () => {
    const item = normalizeScheduleForMobile({
      id: 'sched-1',
      name: 'daily-summary',
      enabled: true,
      cron: '0 8 * * *',
      timeZone: 'Europe/Warsaw',
      promptPreview: 'Prepare a short daily summary for inbox',
      source: 'manual',
      lastResult: 'ok',
      nextFireIso: '2026-06-19T08:00:00.000Z',
    }, 0);

    expect(item).toMatchObject({
      id: 'sched-1',
      name: 'daily-summary',
      enabled: true,
      promptPreview: 'Prepare a short daily summary for inbox',
      sourceLabel: 'Manual',
      statusLabel: 'Enabled',
      timingLabel: 'Cron 0 8 * * *',
      outcomeLabel: 'Last run ok',
    });
  });

  it('formats one-shot and disabled schedules without leaking raw nulls', () => {
    expect(formatScheduleTiming({
      runAt: 1_780_010_000_000,
      cron: null,
      timeZone: null,
    })).toContain('One-shot');
    expect(formatScheduleTiming({
      runAt: null,
      cron: null,
      timeZone: null,
    })).toBe('No trigger');
  });

  it('builds accessible labels that include state and trigger', () => {
    const item = normalizeScheduleForMobile({
      id: 'sched-2',
      name: 'weekly-research',
      enabled: false,
      cron: '0 9 * * 1',
      source: 'workflow',
      workflowName: 'research-roundup',
      promptPreview: '',
    }, 0);

    expect(buildScheduleAccessibilityLabel(item)).toBe(
      'weekly-research, Disabled, Workflow, Cron 0 9 * * 1',
    );
  });
});
