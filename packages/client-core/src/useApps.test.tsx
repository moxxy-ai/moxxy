/**
 * useAppInstall hook tests — failure-path / re-entrancy hardening.
 *
 * Assert the worst cases the shared install hook must survive: a rapid
 * double-click (or a click during an in-flight uninstall) must NOT fan out
 * overlapping apps.install/apps.uninstall IPC, an install that rejects must
 * surface an error status (no crash, installing flag cleared, progress
 * cleared), and a transcribe-style late resolve after unmount must not setState
 * on a dead tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useAppInstall } from './useApps.js';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import type { AppInstallStatus } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

/** A promise plus its resolver, so a test can park an IPC mid-flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const installed: AppInstallStatus = { appId: 'anonymizer', state: 'installed' };
const notInstalled: AppInstallStatus = { appId: 'anonymizer', state: 'not-installed' };

afterEach(() => {
  __setApiOverride(null);
  vi.restoreAllMocks();
});

describe('useAppInstall', () => {
  it('drops a re-entrant install while one is already in flight (single IPC)', async () => {
    const gate = deferred<AppInstallStatus>();
    let installCalls = 0;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'apps.status') return notInstalled;
      if (cmd === 'apps.install') {
        installCalls += 1;
        return gate.promise;
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppInstall('anonymizer'));
    await waitFor(() => expect(result.current.status).toEqual(notInstalled));

    // Fire two installs back-to-back before the first resolves.
    act(() => {
      void result.current.install();
      void result.current.install();
    });
    expect(result.current.installing).toBe(true);
    // Only ONE apps.install reached the host despite two clicks.
    expect(installCalls).toBe(1);

    await act(async () => {
      gate.resolve(installed);
      await gate.promise;
    });
    await waitFor(() => expect(result.current.installing).toBe(false));
    expect(result.current.status).toEqual(installed);
    expect(installCalls).toBe(1);
  });

  it('drops an uninstall click while an install is still running', async () => {
    const gate = deferred<AppInstallStatus>();
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'apps.status') return notInstalled;
      if (cmd === 'apps.install') return gate.promise;
      if (cmd === 'apps.uninstall') return notInstalled;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppInstall('anonymizer'));
    await waitFor(() => expect(result.current.status).toEqual(notInstalled));

    act(() => {
      void result.current.install();
      void result.current.uninstall(); // must be dropped — install holds the lock
    });
    expect(invoke).not.toHaveBeenCalledWith('apps.uninstall', expect.anything());

    await act(async () => {
      gate.resolve(installed);
      await gate.promise;
    });
    await waitFor(() => expect(result.current.installing).toBe(false));
  });

  it('install rejection surfaces an error status, clears installing + progress, no crash', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'apps.status') return notInstalled;
      if (cmd === 'apps.install') throw new Error('network down');
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppInstall('anonymizer'));
    await waitFor(() => expect(result.current.status).toEqual(notInstalled));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.status).toMatchObject({ state: 'error' });
    expect(result.current.installing).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('a re-entrant install can run AGAIN after the first completes (lock released)', async () => {
    let installCalls = 0;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'apps.status') return notInstalled;
      if (cmd === 'apps.install') {
        installCalls += 1;
        return installed;
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useAppInstall('anonymizer'));
    await waitFor(() => expect(result.current.status).toEqual(notInstalled));

    await act(async () => {
      await result.current.install();
    });
    await act(async () => {
      await result.current.install();
    });
    expect(installCalls).toBe(2); // lock released between calls
  });

  it('an install resolving AFTER unmount does not throw (no setState on dead tree)', async () => {
    const gate = deferred<AppInstallStatus>();
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'apps.status') return notInstalled;
      if (cmd === 'apps.install') return gate.promise;
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result, unmount } = renderHook(() => useAppInstall('anonymizer'));
    await waitFor(() => expect(result.current.status).toEqual(notInstalled));

    act(() => {
      void result.current.install();
    });
    unmount();
    // Resolving after unmount must not throw an unhandled state-update.
    await act(async () => {
      gate.resolve(installed);
      await gate.promise;
    });
  });
});
