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

describe('UpdateBanner', () => {
  it('updates everything and restarts after one click', async () => {
    const invoke = host({ 'app.updateComponents': { ok: true, updated: true } });
    render(<UpdateBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app.relaunch'));
    expect(screen.getByText(/Restarting Moxxy/)).toBeTruthy();
  });

  it('says Moxxy still works and offers another try when the update fails', async () => {
    const invoke = host({ 'app.updateComponents': { ok: false, updated: false, error: 'no network' } });
    render(<UpdateBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));

    expect(await screen.findByText(/works as before/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'app.updateComponents')).toHaveLength(2));
    expect(invoke).not.toHaveBeenCalledWith('app.relaunch');
  });
});
