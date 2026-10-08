/**
 * useAppUpdate tests — the ONE update is the host's (`app.updateAll`): it
 * decides the steps, carries them out and restarts. The hook asks for it and
 * reflects the plan the host reports.
 *
 * Driven through the fake `api` shim (`__setApiOverride`), which stands in for
 * the IPC transport; what an update does is tested host-side
 * (`@moxxy/desktop-host` update-plan).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useAppUpdate } from './useAppUpdate.js';
import type { AppUpdateCheck, AppUpdatePlan, ComponentUpdateCheck, MoxxyApi } from '@moxxy/desktop-ipc-contract';

/** What the host pushed listeners for, by event name. */
const listeners = new Map<string, (payload: unknown) => void>();

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  const subscribe = ((event: string, listener: (payload: unknown) => void) => {
    listeners.set(event, listener);
    return () => listeners.delete(event);
  }) as MoxxyApi['subscribe'];
  return { invoke, subscribe };
}

afterEach(() => {
  __setApiOverride(null);
  listeners.clear();
});

const cliInfo = { version: '1.0.0', path: '/x/moxxy' };
const updateInfo = { version: '0.5.0', source: 'bundled' as const, channelConfigured: true };

const availableCheck: AppUpdateCheck = {
  available: true,
  currentVersion: '0.5.0',
  latestVersion: '0.6.0',
  compatible: true,
};
const uptodateCheck: AppUpdateCheck = {
  available: false,
  currentVersion: '0.5.0',
  latestVersion: '0.5.0',
  compatible: true,
};

const componentsBehind: ComponentUpdateCheck = {
  available: true,
  version: '1.1.0',
  runner: { current: '1.0.0' },
  extensions: [{ name: '@moxxy/plugin-terminal', current: '1.0.0' }],
};
const componentsCurrent: ComponentUpdateCheck = { available: false, version: null, runner: null, extensions: [] };

const restartingPlan: AppUpdatePlan = {
  id: 'plan-1',
  createdAt: 1_000,
  route: 'hot',
  version: '0.6.0',
  steps: [
    { id: 'app', status: 'done' },
    { id: 'restart', status: 'running' },
  ],
};
const failedPlan: AppUpdatePlan = {
  ...restartingPlan,
  steps: [
    { id: 'app', status: 'failed', error: 'download failed: E404' },
    { id: 'restart', status: 'pending' },
  ],
};

/** A host whose answers default to "everything is current". */
function host(answers: Partial<Record<string, unknown>> = {}) {
  const invoke = vi.fn(async (cmd: string) => {
    const defaults: Record<string, unknown> = {
      'app.updateInfo': updateInfo,
      'app.cliInfo': cliInfo,
      'app.checkUpdate': uptodateCheck,
      'app.checkComponents': componentsCurrent,
      'app.updatePlan': null,
      'app.updateAll': { ok: true, plan: null },
    };
    const answer = cmd in answers ? answers[cmd] : defaults[cmd];
    if (!(cmd in answers) && !(cmd in defaults)) throw new Error(`unexpected ${cmd}`);
    return answer;
  });
  __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));
  return invoke;
}

const calls = (invoke: ReturnType<typeof host>) => invoke.mock.calls.map(([cmd]) => cmd);

describe('useAppUpdate.runCheck', () => {
  it('offers nothing when only the runner or extensions are behind: they follow the app', async () => {
    const invoke = host({ 'app.checkComponents': componentsBehind });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('uptodate');
    expect(calls(invoke)).not.toContain('app.checkComponents');
  });

  it('stays quiet when nothing can be checked (offline)', async () => {
    host({ 'app.checkUpdate': { ...uptodateCheck, available: false, error: 'offline' } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('unavailable');
  });

  it('says the last update did not take effect while it is still on offer', async () => {
    host({
      'app.checkUpdate': availableCheck,
      'app.updatePlan': {
        ...restartingPlan,
        steps: [{ id: 'app', status: 'done' }, { id: 'restart', status: 'failed', error: 'Moxxy restarted on version 0.5.0, not 0.6.0.' }],
      },
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('available');
    expect(result.current.error).toMatch(/restarted on version 0\.5\.0/);
  });

  it('forgets a failed update once nothing is on offer', async () => {
    host({ 'app.updatePlan': failedPlan });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('uptodate');
    expect(result.current.error).toBeNull();
  });
});

describe('useAppUpdate.runUpdateAll', () => {
  it('asks the host for the whole update and shows the restart', async () => {
    const invoke = host({ 'app.updateAll': { ok: true, plan: restartingPlan } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(calls(invoke)).toContain('app.updateAll');
    // The host installs and restarts; the renderer drives none of it.
    for (const cmd of ['app.updateComponents', 'app.updateDashboard', 'app.updateShell', 'app.relaunch']) {
      expect(invoke).not.toHaveBeenCalledWith(cmd);
    }
    expect(result.current.state).toBe('staged');
    expect(result.current.stagedVersion).toBe('0.6.0');
    expect(result.current.plan).toEqual(restartingPlan);
  });

  it('offers another try, with the reason, when a step fails', async () => {
    host({ 'app.updateAll': { ok: false, plan: failedPlan, error: 'download failed: E404' } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/works as before/);
    expect(result.current.error).toMatch(/E404/);
  });

  it('keeps the manual download reachable when the installer fails', async () => {
    const installerPlan: AppUpdatePlan = {
      ...restartingPlan,
      route: 'installer',
      steps: [{ id: 'installer', status: 'failed', error: 'No installer found for this release.' }, { id: 'restart', status: 'pending' }],
    };
    host({ 'app.updateAll': { ok: false, plan: installerPlan, error: 'No installer found for this release.' } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('requires-full-update');
    expect(result.current.error).toMatch(/No installer found/);
  });

  it('reports up to date when the host finds nothing to do', async () => {
    host();
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('uptodate');
  });

  it('follows the plan as the host reports each step', async () => {
    host();
    const { result } = renderHook(() => useAppUpdate());

    act(() => listeners.get('app.update.plan')?.(failedPlan));

    expect(result.current.plan).toEqual(failedPlan);
  });
});

describe('useAppUpdate — the runner, by hand', () => {
  it('shows with the details whether the runner is behind the app', async () => {
    host({ 'app.checkComponents': componentsBehind, 'app.updateDiagnostics': null });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.loadDiagnostics();
    });

    expect(result.current.components).toEqual(componentsBehind);
  });

  it('brings it up to date and reads the versions again', async () => {
    const invoke = host({ 'app.checkComponents': componentsBehind, 'app.updateComponents': { ok: true, updated: true } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runComponentsUpdate();
    });

    expect(calls(invoke).filter((cmd) => cmd === 'app.cliInfo')).toHaveLength(2);
    expect(result.current.cliError).toBeNull();
    expect(result.current.componentsBusy).toBe(false);
  });

  it('says why it could not', async () => {
    host({ 'app.updateComponents': { ok: false, updated: false, error: 'npm not found' } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runComponentsUpdate();
    });

    expect(result.current.cliError).toMatch(/npm not found/);
  });
});
