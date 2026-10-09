/**
 * The installer flow end to end in the window: what the host reports becomes
 * the screen, and the screen leaves by itself once Moxxy is ready. The fake
 * `api` shim stands in for the IPC transport.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AppSetupState, AppUpdatePlan } from '@moxxy/desktop-ipc-contract';
import { UpdateFlow } from './UpdateFlow';

const listeners = new Map<string, (payload: unknown) => void>();
const emit = (event: string, payload: unknown): void => act(() => listeners.get(event)?.(payload));

function host(setup: AppSetupState | null) {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === 'app.setup') return setup ?? { reason: null, phase: 'done', steps: [], notes: [] };
    if (cmd === 'app.updateAll') return { ok: true, plan: null };
    if (cmd === 'onboarding.openExternal') return undefined;
    if (cmd === 'app.revertUpdate') return undefined;
    throw new Error(`unexpected ${cmd}`);
  });
  __setApiOverride({
    invoke,
    subscribe: (event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  } as never);
  return invoke;
}

afterEach(() => {
  cleanup();
  __setApiOverride(null);
  listeners.clear();
});

const settingUp: AppSetupState = { reason: 'update', phase: 'running', steps: [{ id: 'extensions', status: 'running' }], notes: [] };
const setUp: AppSetupState = { ...settingUp, phase: 'done', steps: [{ id: 'extensions', status: 'done' }] };
const downloading: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [{ id: 'app', status: 'running' }, { id: 'restart', status: 'pending' }],
};

describe('UpdateFlow', () => {
  it('shows nothing on an ordinary launch', async () => {
    const invoke = host(null);
    render(<UpdateFlow runner="ready" onboarded />);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('app.setup'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('takes over the window when an update starts', async () => {
    host(null);
    render(<UpdateFlow runner="ready" onboarded />);

    emit('app.update.plan', downloading);

    expect(await screen.findByRole('dialog', { name: 'Updating Moxxy' })).toBeTruthy();
  });

  it('finishes the update after the restart and leaves once Moxxy is ready', async () => {
    host(settingUp);
    const { rerender } = render(<UpdateFlow runner="starting" onboarded />);
    const dialog = await screen.findByRole('dialog', { name: 'Finishing the update' });

    emit('app.setup.changed', setUp);
    expect(dialog.getAttribute('data-leaving')).toBeNull();
    rerender(<UpdateFlow runner="ready" onboarded />);

    expect(dialog.getAttribute('data-leaving')).toBe('true');
    fireEvent.animationEnd(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands the window over for good once the runtime has failed to start', async () => {
    host(setUp);
    const { rerender } = render(<UpdateFlow runner="starting" onboarded />);
    const dialog = await screen.findByRole('dialog', { name: 'Finishing the update' });

    rerender(<UpdateFlow runner="stopped" onboarded />);
    fireEvent.animationEnd(dialog);
    // The connection screen retries the start; that is its business now.
    rerender(<UpdateFlow runner="starting" onboarded />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the release page when the system refused the installer', async () => {
    const invoke = host(null);
    const releaseUrl = 'https://github.com/moxxy-ai/moxxy/releases/tag/desktop-v0.6.0';
    render(<UpdateFlow runner="ready" onboarded />);
    emit('app.update.plan', {
      ...downloading,
      route: 'installer',
      releaseUrl,
      steps: [{ id: 'installer', status: 'failed', error: 'not signed' }, { id: 'restart', status: 'pending' }],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Download the installer' }));

    expect(invoke).toHaveBeenCalledWith('onboarding.openExternal', { url: releaseUrl });
  });

  it('goes back to the version before when only the installed app was left to update and the person gives up', async () => {
    const invoke = host(null);
    render(<UpdateFlow runner="stopped" onboarded />);
    emit('app.update.plan', {
      ...downloading,
      route: 'installer',
      completes: true,
      steps: [{ id: 'installer', status: 'failed', error: 'offline' }, { id: 'restart', status: 'pending' }],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(invoke).toHaveBeenCalledWith('app.revertUpdate');
    // Nothing to go on with behind it: the screen stays until Moxxy restarts.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('asks the host again when a failed update is retried, and stays closed when it is not', async () => {
    const invoke = host(null);
    render(<UpdateFlow runner="ready" onboarded />);
    emit('app.update.plan', { ...downloading, steps: [{ id: 'app', status: 'failed', error: 'offline' }, { id: 'restart', status: 'pending' }] });

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(invoke).toHaveBeenCalledWith('app.updateAll');

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
