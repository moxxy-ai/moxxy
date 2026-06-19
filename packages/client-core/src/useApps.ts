import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { AppInstallProgress, AppInstallStatus } from '@moxxy/desktop-ipc-contract';

export interface UseAppInstall {
  /** Current install state (null until the first `apps.status` resolves). */
  readonly status: AppInstallStatus | null;
  /** Live download progress while installing (cleared when idle). */
  readonly progress: AppInstallProgress | null;
  readonly installing: boolean;
  readonly install: () => Promise<void>;
  readonly uninstall: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

/**
 * Drives one app's install lifecycle from the Apps gallery: reads
 * `apps.status`, runs `apps.install` / `apps.uninstall`, and tracks the
 * streamed `apps.install.progress` (filtered to this `appId`).
 */
export function useAppInstall(appId: string): UseAppInstall {
  const [status, setStatus] = useState<AppInstallStatus | null>(null);
  const [progress, setProgress] = useState<AppInstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);

  // Synchronous re-entrancy guard. `installing` (React state) doesn't update
  // until the next render, so a rapid double-click (or a click during an
  // in-flight uninstall) would fire overlapping apps.install/apps.uninstall IPC
  // before the disabled state lands. The ref flips synchronously to drop the
  // second call. Covers install AND uninstall (they're mutually exclusive).
  const busyRef = useRef(false);
  // Bail out of post-await state writes after unmount (the gallery row can be
  // removed mid-install, e.g. the app list re-renders).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await api().invoke('apps.status', { appId });
      if (mountedRef.current) setStatus(next);
    } catch (e) {
      if (mountedRef.current) setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    }
  }, [appId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progress is broadcast for ALL installs — keep only this app's.
  useEffect(() => {
    const off = api().subscribe('apps.install.progress', (p: AppInstallProgress) => {
      if (p.appId !== appId) return;
      if (mountedRef.current) setProgress(p.phase === 'done' || p.phase === 'error' ? null : p);
    });
    return off;
  }, [appId]);

  const install = useCallback(async (): Promise<void> => {
    if (busyRef.current) return; // drop a re-entrant click while a lifecycle op runs
    busyRef.current = true;
    setInstalling(true);
    try {
      const next = await api().invoke('apps.install', { appId });
      if (mountedRef.current) setStatus(next);
    } catch (e) {
      if (mountedRef.current) setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    } finally {
      busyRef.current = false;
      if (mountedRef.current) {
        setInstalling(false);
        setProgress(null);
      }
    }
  }, [appId]);

  const uninstall = useCallback(async (): Promise<void> => {
    if (busyRef.current) return; // drop a re-entrant click while a lifecycle op runs
    busyRef.current = true;
    try {
      const next = await api().invoke('apps.uninstall', { appId });
      if (mountedRef.current) setStatus(next);
    } catch (e) {
      if (mountedRef.current) setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    } finally {
      busyRef.current = false;
      // Clear any stale progress a prior install left behind (mirrors install).
      if (mountedRef.current) setProgress(null);
    }
  }, [appId]);

  return { status, progress, installing, install, uninstall, refresh };
}
