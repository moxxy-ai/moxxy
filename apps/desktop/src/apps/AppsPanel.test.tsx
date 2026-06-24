/**
 * Apps surface tests: the view lands on the installable-app gallery, carries a
 * right-aligned Workflows / Schedules / Webhooks sub-nav, and switching a chip
 * swaps the body to that surface (Schedules reads scheduler.list; Webhooks reads
 * the real webhooks.list). Re-clicking the active chip returns to the gallery.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, ScheduleSummary, WebhookSummary } from '@moxxy/desktop-ipc-contract';

// Side-effect registry import: no-op so the gallery starts empty + deterministic.
vi.mock('./builtins', () => ({}));
vi.mock('./registry', () => ({
  listDesktopApps: () => [],
  getDesktopApp: () => undefined,
}));

import { AppsPanel } from './AppsPanel';

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
  source: 'manual',
  skillName: null,
  workflowName: null,
  createdAt: 0,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  nextFireAt: null,
  nextFireIso: null,
};

const webhook: WebhookSummary = {
  id: 'wh-1',
  name: 'github-push',
  description: null,
  enabled: true,
  url: null,
  localPath: '/webhook/wh-1',
  promptPreview: 'a push landed',
  model: null,
  fireCount: 2,
  lastFiredAt: null,
  lastResult: 'ok',
  lastError: null,
  createdAt: 0,
};

function installApi(): void {
  __setApiOverride({
    invoke: ((cmd: string) => {
      if (cmd === 'scheduler.list') return Promise.resolve([schedule]);
      if (cmd === 'webhooks.list') return Promise.resolve([webhook]);
      if (cmd === 'workflows.list') return Promise.resolve([]);
      if (cmd === 'workflows.getRun') return Promise.resolve(null);
      if (cmd === 'session.info') return Promise.resolve(null);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => {}) as never,
  } as MoxxyApi);
}

afterEach(() => __setApiOverride(null));

describe('AppsPanel', () => {
  it('lands on the gallery with the Workflows/Schedules/Webhooks sub-nav', () => {
    installApi();
    render(<AppsPanel onView={vi.fn()} />);
    expect(screen.getByText('No apps available.')).toBeInTheDocument();
    expect(screen.getByTestId('apps-tab-workflows')).toBeTruthy();
    expect(screen.getByTestId('apps-tab-schedules')).toBeTruthy();
    expect(screen.getByTestId('apps-tab-webhooks')).toBeTruthy();
  });

  it('switches to Schedules + Webhooks and toggles back to the gallery', async () => {
    installApi();
    render(<AppsPanel onView={vi.fn()} />);

    fireEvent.click(screen.getByTestId('apps-tab-schedules'));
    await waitFor(() => expect(screen.getByTestId('schedule-row-sched-1')).toBeTruthy());
    expect(screen.queryByText('No apps available.')).toBeNull();

    fireEvent.click(screen.getByTestId('apps-tab-webhooks'));
    await waitFor(() => expect(screen.getByTestId('webhook-row-wh-1')).toBeTruthy());

    // Re-clicking the active chip returns to the gallery.
    fireEvent.click(screen.getByTestId('apps-tab-webhooks'));
    expect(screen.getByText('No apps available.')).toBeInTheDocument();
  });
});
