/**
 * Renderer-side state machine for the dashboard self-update flow, shared by the
 * About → Updates panel and the launch banner.
 *
 * Drives the three IPC commands (`app.updateInfo` / `app.checkUpdate` /
 * `app.updateDashboard`) and subscribes to `app.update.progress` so the UI can
 * show a bar while the bundle downloads. The actual download/verify/install all
 * happen main-side; this only orchestrates and reflects status.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppUpdateCheck,
  AppUpdateInfo,
  AppUpdateProgress,
} from '@moxxy/desktop-ipc-contract';
import { api } from '@/lib/api';
import { toErrorMessage } from '@/lib/errors';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available' // newer + compatible → can hot-update
  | 'incompatible' // newer but needs a full app/shell update
  | 'unavailable' // not configured / dev / offline
  | 'updating'
  | 'staged' // installed; relaunch to apply
  | 'error';

export interface UseAppUpdate {
  info: AppUpdateInfo | null;
  check: AppUpdateCheck | null;
  state: UpdateState;
  progress: AppUpdateProgress | null;
  error: string | null;
  stagedVersion: string | null;
  runCheck: () => Promise<void>;
  runUpdate: () => Promise<void>;
  relaunch: () => void;
}

export function useAppUpdate(opts: { autoCheck?: boolean } = {}): UseAppUpdate {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [check, setCheck] = useState<AppUpdateCheck | null>(null);
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stagedVersion, setStagedVersion] = useState<string | null>(null);
  const autoChecked = useRef(false);

  useEffect(() => {
    void api()
      .invoke('app.updateInfo')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    const off = api().subscribe('app.update.progress', (p: AppUpdateProgress) => setProgress(p));
    return off;
  }, []);

  const runCheck = useCallback(async (): Promise<void> => {
    setState('checking');
    setError(null);
    try {
      const c = await api().invoke('app.checkUpdate');
      setCheck(c);
      if (c.error) setState('unavailable');
      else if (!c.available) setState('uptodate');
      else if (!c.compatible) setState('incompatible');
      else setState('available');
    } catch (e) {
      setError(toErrorMessage(e));
      setState('error');
    }
  }, []);

  const runUpdate = useCallback(async (): Promise<void> => {
    setState('updating');
    setError(null);
    setProgress(null);
    try {
      const r = await api().invoke('app.updateDashboard');
      if (r.ok && r.version) {
        setStagedVersion(r.version);
        setState('staged');
      } else {
        setError(r.error ?? 'Update failed.');
        setState('error');
      }
    } catch (e) {
      setError(toErrorMessage(e));
      setState('error');
    }
  }, []);

  const relaunch = useCallback((): void => {
    void api().invoke('app.relaunch').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (opts.autoCheck && !autoChecked.current) {
      autoChecked.current = true;
      void runCheck();
    }
  }, [opts.autoCheck, runCheck]);

  return { info, check, state, progress, error, stagedVersion, runCheck, runUpdate, relaunch };
}
