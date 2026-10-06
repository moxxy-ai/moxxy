/**
 * useAppUpdate orchestration tests — the ONE update that brings the runner and
 * extensions (`app.updateComponents`) and the desktop app (`app.checkUpdate` →
 * `app.updateDashboard` / `app.updateShell`) to latest, then relaunches.
 *
 * Driven through the fake `api` shim (`__setApiOverride`); the real
 * download/verify/install all happen main-side, so this only asserts the
 * renderer-side state machine + the sequence of IPC calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useAppUpdate } from './useAppUpdate.js';
import type { AppUpdateCheck, ComponentUpdateCheck, MoxxyApi } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

afterEach(() => __setApiOverride(null));

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

/** A host whose answers default to "everything is current". */
function host(answers: Partial<Record<string, unknown>> = {}) {
  const invoke = vi.fn(async (cmd: string) => {
    const defaults: Record<string, unknown> = {
      'app.updateInfo': updateInfo,
      'app.cliInfo': cliInfo,
      'app.checkUpdate': uptodateCheck,
      'app.checkComponents': componentsCurrent,
      'app.updateComponents': { ok: true, updated: false },
      'app.relaunch': undefined,
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
  it('offers an update when only the runner or extensions are behind', async () => {
    host({ 'app.checkComponents': componentsBehind });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('available');
  });

  it('stays quiet when nothing can be checked (offline)', async () => {
    host({
      'app.checkUpdate': { ...uptodateCheck, available: false, error: 'offline' },
      'app.checkComponents': { ...componentsCurrent, error: 'offline' },
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runCheck();
    });

    expect(result.current.state).toBe('unavailable');
  });
});

describe('useAppUpdate.runUpdateAll', () => {
  it('updates the runner and extensions, then the app, then relaunches on its own', async () => {
    const invoke = host({
      'app.checkUpdate': availableCheck,
      'app.checkComponents': componentsBehind,
      'app.updateComponents': { ok: true, updated: true },
      'app.updateDashboard': { ok: true, version: '0.6.0' },
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    const order = calls(invoke);
    expect(order.indexOf('app.updateComponents')).toBeLessThan(order.indexOf('app.updateDashboard'));
    expect(order.at(-1)).toBe('app.relaunch');
    expect(result.current.state).toBe('staged');
  });

  it('relaunches after updating only the runner and extensions', async () => {
    const invoke = host({ 'app.checkComponents': componentsBehind, 'app.updateComponents': { ok: true, updated: true } });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(invoke).toHaveBeenCalledWith('app.relaunch');
    expect(invoke).not.toHaveBeenCalledWith('app.updateDashboard');
  });

  it('changes nothing and offers another try when the runner or extensions fail', async () => {
    const invoke = host({
      'app.checkUpdate': availableCheck,
      'app.checkComponents': componentsBehind,
      'app.updateComponents': { ok: false, updated: false, error: 'npm install failed (exit 1): E404' },
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/works as before/);
    expect(invoke).not.toHaveBeenCalledWith('app.updateDashboard');
    expect(invoke).not.toHaveBeenCalledWith('app.relaunch');
  });

  it('still updates the app when the runner cannot be updated here (no Node.js)', async () => {
    const invoke = host({
      'app.checkUpdate': availableCheck,
      'app.checkComponents': { ...componentsCurrent, error: 'npm not found' },
      'app.updateComponents': { ok: false, updated: false, error: 'npm not found' },
      'app.updateDashboard': { ok: true, version: '0.6.0' },
    });
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(invoke).not.toHaveBeenCalledWith('app.updateComponents');
    expect(invoke).toHaveBeenCalledWith('app.relaunch');
    expect(result.current.cliError).toMatch(/npm not found/);
  });

  it('does nothing and relaunches nothing when everything is current', async () => {
    const invoke = host();
    const { result } = renderHook(() => useAppUpdate());

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('uptodate');
    expect(invoke).not.toHaveBeenCalledWith('app.updateDashboard');
    expect(invoke).not.toHaveBeenCalledWith('app.relaunch');
  });
});
