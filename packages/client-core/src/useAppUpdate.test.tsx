/**
 * useAppUpdate.runUpdateAll orchestration tests — the ONE unified update that
 * brings both the runner (`app.updateCli`) and the desktop app
 * (`app.checkUpdate` → `app.updateDashboard` / `app.updateShell`) to latest.
 *
 * Driven through the fake `api` shim (`__setApiOverride`); the real
 * download/verify/install all happen main-side, so this only asserts the
 * renderer-side state machine + the sequence of IPC calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useAppUpdate } from './useAppUpdate.js';
import type { AppUpdateCheck, MoxxyApi } from '@moxxy/desktop-ipc-contract';

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

describe('useAppUpdate.runUpdateAll', () => {
  it('CLI ok + dashboard available → staged', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      switch (cmd) {
        case 'app.updateInfo':
          return updateInfo;
        case 'app.cliInfo':
          return cliInfo;
        case 'app.updateCli':
          return { code: 0, version: '1.1.0' };
        case 'app.checkUpdate':
          return availableCheck;
        case 'app.updateDashboard':
          return { ok: true, version: '0.6.0' };
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.cliInfo).toEqual(cliInfo));

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('staged');
    expect(result.current.stagedVersion).toBe('0.6.0');
    expect(result.current.cliError).toBeNull();
    // The runner restarted live with the new version.
    expect(result.current.cliInfo?.version).toBe('1.1.0');
    expect(invoke).toHaveBeenCalledWith('app.updateCli');
    expect(invoke).toHaveBeenCalledWith('app.updateDashboard');
  });

  it('CLI fails (code≠0) but dashboard available → still staged, cliError set', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      switch (cmd) {
        case 'app.updateInfo':
          return updateInfo;
        case 'app.cliInfo':
          return cliInfo;
        case 'app.updateCli':
          return { code: 1, version: null };
        case 'app.checkUpdate':
          return availableCheck;
        case 'app.updateDashboard':
          return { ok: true, version: '0.6.0' };
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.cliInfo).toEqual(cliInfo));

    await act(async () => {
      await result.current.runUpdateAll();
    });

    // The runner failure is non-fatal: the app update still proceeds + stages.
    expect(result.current.state).toBe('staged');
    expect(result.current.stagedVersion).toBe('0.6.0');
    expect(result.current.cliError).toMatch(/code 1/);
    expect(invoke).toHaveBeenCalledWith('app.updateDashboard');
  });

  it('everything up to date → uptodate', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      switch (cmd) {
        case 'app.updateInfo':
          return updateInfo;
        case 'app.cliInfo':
          return cliInfo;
        case 'app.updateCli':
          return { code: 0, version: '1.0.0' };
        case 'app.checkUpdate':
          return uptodateCheck;
        default:
          throw new Error(`unexpected ${cmd}`);
      }
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppUpdate());
    await waitFor(() => expect(result.current.cliInfo).toEqual(cliInfo));

    await act(async () => {
      await result.current.runUpdateAll();
    });

    expect(result.current.state).toBe('uptodate');
    expect(result.current.stagedVersion).toBeNull();
    expect(result.current.cliError).toBeNull();
    // No dashboard install was attempted — the app was already current.
    expect(invoke).not.toHaveBeenCalledWith('app.updateDashboard');
    expect(invoke).not.toHaveBeenCalledWith('app.updateShell');
  });
});
