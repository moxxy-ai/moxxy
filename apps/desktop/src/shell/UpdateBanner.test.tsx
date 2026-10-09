/**
 * The launch banner is the update people who aren't technical see: one
 * "Update" click has to bring everything up to date and restart, with nothing
 * to decide — and a failure has to say that Moxxy still works and offer
 * another try.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { UpdateBanner } from './UpdateBanner';

const componentsBehind = {
  available: true,
  version: '1.1.0',
  runner: { current: '1.0.0' },
  extensions: [{ name: '@moxxy/plugin-terminal', current: '1.0.0' }],
};

function host(answers: Record<string, unknown>) {
  const invoke = vi.fn(async (channel: string) => {
    const defaults: Record<string, unknown> = {
      'app.updateInfo': { version: '0.5.0', source: 'bundled', channelConfigured: true },
      'app.cliInfo': { version: '1.0.0', path: '/x' },
      'app.checkUpdate': { available: false, currentVersion: '0.5.0', latestVersion: '0.5.0', compatible: true },
      'app.checkComponents': componentsBehind,
      'app.updatePlan': null,
    };
    return channel in answers ? answers[channel] : defaults[channel];
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return invoke;
}

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

const appBehind = { available: true, currentVersion: '0.5.0', latestVersion: '0.6.0', compatible: true };
const restarting = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [
    { id: 'app', status: 'done' },
    { id: 'restart', status: 'running' },
  ],
};
const failed = {
  ...restarting,
  steps: [
    { id: 'app', status: 'failed', error: 'no network' },
    { id: 'restart', status: 'pending' },
  ],
};

describe('UpdateBanner', () => {
  it('stays away when only the runner or extensions are behind: they come with the app', async () => {
    const invoke = host({});
    render(<UpdateBanner />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app.checkUpdate'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app.updatePlan'));
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  });

  it('hands the whole update to the host after one click and steps aside for the installer screen', async () => {
    const invoke = host({ 'app.checkUpdate': appBehind, 'app.updateAll': { ok: true, plan: restarting } });
    render(<UpdateBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(invoke.mock.calls.filter(([c]) => c === 'app.updateAll')).toHaveLength(1);
  });

  it('says Moxxy still works and offers another try when the update fails', async () => {
    const invoke = host({ 'app.checkUpdate': appBehind, 'app.updateAll': { ok: false, plan: failed, error: 'no network' } });
    render(<UpdateBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));

    expect(await screen.findByText(/works as before/)).toBeTruthy();
    expect(screen.getByText(/no network/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'app.updateAll')).toHaveLength(2));
  });
});
