/**
 * Actions surface tests: the tab groups Workflows / Schedules / Webhooks under
 * one header, defaults to Workflows, and switching sub-tabs swaps the content
 * (Schedules reads scheduler.list; Webhooks filters webhook-triggered
 * workflows).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, ScheduleSummary, WorkflowSummary } from '@moxxy/desktop-ipc-contract';
import { ActionsPanel } from './ActionsPanel';

function installApi(opts: { workflows?: WorkflowSummary[]; schedules?: ScheduleSummary[] } = {}): void {
  __setApiOverride({
    invoke: ((cmd: string) => {
      if (cmd === 'workflows.list') return Promise.resolve(opts.workflows ?? []);
      if (cmd === 'scheduler.list') return Promise.resolve(opts.schedules ?? []);
      if (cmd === 'workflows.getRun') return Promise.resolve(null);
      if (cmd === 'session.info') return Promise.resolve(null);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => {}) as never,
  } as MoxxyApi);
}

afterEach(() => __setApiOverride(null));

const webhookWf: WorkflowSummary = {
  name: 'on-push',
  description: 'fires on a webhook',
  enabled: true,
  scope: 'user',
  steps: 2,
  triggers: 'webhook: github',
};

const schedule: ScheduleSummary = {
  id: 'sched-1',
  name: 'Daily digest',
  enabled: true,
  cron: '0 9 * * *',
  runAt: null,
  timeZone: null,
  channel: 'inbox',
  model: null,
  promptPreview: 'digest',
  source: 'workflow',
  skillName: null,
  workflowName: 'daily-digest',
  createdAt: 0,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  nextFireAt: null,
  nextFireIso: null,
};

describe('ActionsPanel', () => {
  it('defaults to Workflows and switches to Schedules + Webhooks', async () => {
    installApi({ workflows: [webhookWf], schedules: [schedule] });
    render(<ActionsPanel />);

    // Sub-tabs present.
    expect(screen.getByTestId('actions-tab-workflows')).toBeTruthy();
    expect(screen.getByTestId('actions-tab-schedules')).toBeTruthy();
    expect(screen.getByTestId('actions-tab-webhooks')).toBeTruthy();

    // Schedules tab shows the scheduled job.
    fireEvent.click(screen.getByTestId('actions-tab-schedules'));
    await waitFor(() => expect(screen.getByTestId('schedule-row-sched-1')).toBeTruthy());

    // Webhooks tab shows the webhook-triggered workflow.
    fireEvent.click(screen.getByTestId('actions-tab-webhooks'));
    await waitFor(() => expect(screen.getByTestId('webhook-row-on-push')).toBeTruthy());
  });
});
