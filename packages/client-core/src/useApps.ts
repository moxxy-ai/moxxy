import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api().invoke('apps.status', { appId }));
    } catch (e) {
      setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    }
  }, [appId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Progress is broadcast for ALL installs — keep only this app's.
  useEffect(() => {
    const off = api().subscribe('apps.install.progress', (p: AppInstallProgress) => {
      if (p.appId !== appId) return;
      setProgress(p.phase === 'done' || p.phase === 'error' ? null : p);
    });
    return off;
  }, [appId]);

  const install = useCallback(async (): Promise<void> => {
    setInstalling(true);
    try {
      setStatus(await api().invoke('apps.install', { appId }));
    } catch (e) {
      setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, [appId]);

  const uninstall = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api().invoke('apps.uninstall', { appId }));
    } catch (e) {
      setStatus({ appId, state: 'error', error: toErrorMessage(e) });
    }
  }, [appId]);

  return { status, progress, installing, install, uninstall, refresh };
}
