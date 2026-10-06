/**
 * Renderer-side state machine for the self-update flow, shared by the
 * Settings → Update panel and the launch banner.
 *
 * Drives the dashboard IPC commands (`app.updateInfo` / `app.checkUpdate` /
 * `app.updateDashboard` / `app.updateShell`) plus the runner-and-extensions
 * commands (`app.cliInfo` / `app.checkComponents` / `app.updateComponents`),
 * and subscribes to `app.update.progress` so the UI can show progress. The
 * actual download/verify/install all happen main-side; this only orchestrates
 * and reflects status.
 *
 * The unified {@link UseAppUpdate.runUpdateAll} is the one "Update" people
 * click: it brings the runner, the extensions and the desktop app to latest
 * and relaunches — no second step, nothing to decide.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppUpdateCheck,
  ComponentUpdateCheck,
  AppUpdateDiagnostics,
  AppUpdateInfo,
  AppUpdateProgress,
} from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available' // newer + compatible → can hot-update
  | 'incompatible' // newer but needs a full app/shell update
  | 'requires-full-update' // newer but its runner protocol outruns the bundled CLI → full installer only
  | 'unavailable' // not configured / dev / offline
  | 'updating'
  | 'staged' // installed; relaunch to apply
  | 'error';

export interface UseAppUpdate {
  info: AppUpdateInfo | null;
  check: AppUpdateCheck | null;
  /** The runner + extensions side of the last check. */
  components: ComponentUpdateCheck | null;
  state: UpdateState;
  progress: AppUpdateProgress | null;
  error: string | null;
  stagedVersion: string | null;
  diagnostics: AppUpdateDiagnostics | null;
  /** Version + on-disk path of the moxxy CLI ("runner") the desktop spawns,
   *  fetched on mount via `app.cliInfo`. Either field may be null if it can't
   *  be resolved. */
  cliInfo: { version: string | null; path: string | null } | null;
  /** Non-fatal note when the runner and extensions can't be updated here
   *  (e.g. npm not on PATH). The installed ones keep working, so this never
   *  blocks the app update. */
  cliError: string | null;
  runCheck: () => Promise<void>;
  runUpdate: () => Promise<void>;
  /** Tier-2: download the FULL installer and quit into it (`app.updateShell`).
   *  For `requires-full-update` / `incompatible` releases a hot-update can't
   *  deliver. On success the app quits mid-call; on failure the state returns
   *  to the CTA with `error` set so the UI can offer the release page. */
  runShellUpdate: () => Promise<void>;
  /** The ONE update people click: the runner and extensions, then the app,
   *  then a relaunch onto all of it. A part that can't install changes
   *  nothing and leaves `error` set for another try. */
  runUpdateAll: () => Promise<void>;
  loadDiagnostics: () => Promise<void>;
  relaunch: () => void;
}

export function useAppUpdate(opts: { autoCheck?: boolean } = {}): UseAppUpdate {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [check, setCheck] = useState<AppUpdateCheck | null>(null);
  const [components, setComponents] = useState<ComponentUpdateCheck | null>(null);
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stagedVersion, setStagedVersion] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AppUpdateDiagnostics | null>(null);
  const [cliInfo, setCliInfo] = useState<{ version: string | null; path: string | null } | null>(
    null,
  );
  const [cliError, setCliError] = useState<string | null>(null);
  const autoChecked = useRef(false);

  useEffect(() => {
    void api()
      .invoke('app.updateInfo')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  // The runner (CLI) version shown alongside the app/dashboard version: the
  // unified panel surfaces BOTH. Mirrors how `info` is fetched on mount.
  useEffect(() => {
    void api()
      .invoke('app.cliInfo')
      .then(setCliInfo)
      .catch(() => setCliInfo({ version: null, path: null }));
  }, []);

  useEffect(() => {
    const off = api().subscribe('app.update.progress', (p: AppUpdateProgress) => setProgress(p));
    return off;
  }, []);

  const runCheck = useCallback(async (): Promise<void> => {
    setState('checking');
    setError(null);
    try {
      const [c, parts] = await Promise.all([
        api().invoke('app.checkUpdate'),
        api().invoke('app.checkComponents').catch(() => null),
      ]);
      setCheck(c);
      setComponents(parts);
      const appAvailable = !c.error && c.available;
      if (appAvailable && c.requiresFullUpdate) setState('requires-full-update');
      else if (appAvailable && !c.compatible) setState('incompatible');
      else if (appAvailable || parts?.available) setState('available');
      else if (c.error) setState('unavailable');
      else setState('uptodate');
    } catch (e) {
      // A check that can't run is not something to bother anyone with.
      setError(toErrorMessage(e));
      setState('unavailable');
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
      } else if (r.requiresFullUpdate) {
        // The bundle was deliberately not staged — it needs the full installer.
        // Distinct from a failure so the UI shows the Tier-2 call-to-action.
        setError(r.error ?? null);
        setState('requires-full-update');
      } else {
        setError(r.error ?? 'Update failed.');
        setState('error');
      }
    } catch (e) {
      setError(toErrorMessage(e));
      setState('error');
    }
  }, []);

  const runShellUpdate = useCallback(async (): Promise<void> => {
    setState('updating');
    setError(null);
    setProgress(null);
    try {
      const r = await api().invoke('app.updateShell');
      if (r.ok) {
        // The app is quitting into the installer — leave the progress line up.
        setProgress({ phase: 'install', message: 'Restarting to install…' });
      } else {
        // Back to the CTA (with the error shown) so the release-page fallback
        // stays reachable.
        setError(r.error ?? 'Full update failed.');
        setState('requires-full-update');
      }
    } catch (e) {
      setError(toErrorMessage(e));
      setState('requires-full-update');
    }
  }, []);

  /**
   * The one "Update": runner and extensions first — installed and verified
   * beside the live copies main-side, so a failure there changes nothing and
   * stops here — then the desktop app, then a relaunch so everything new runs.
   * When the app can only update through its full installer, the app quits
   * into it instead (the installer brings its own runner).
   */
  const runUpdateAll = useCallback(async (): Promise<void> => {
    setState('updating');
    setError(null);
    setCliError(null);
    setProgress(null);
    let installed = false;
    const failed = (detail?: string): string =>
      `The update could not be finished; Moxxy works as before.${detail ? ` (${detail})` : ''}`;
    const relaunchOntoUpdate = async (): Promise<void> => {
      setState('staged');
      setProgress({ phase: 'install', message: 'Restarting Moxxy…' });
      await api().invoke('app.relaunch').catch(() => undefined);
    };
    const fullInstaller = async (): Promise<void> => {
      const s = await api().invoke('app.updateShell');
      if (s.ok) setProgress({ phase: 'install', message: 'Restarting to install…' });
      else if (installed) await relaunchOntoUpdate();
      else {
        setError(s.error ?? 'Full update failed.');
        setState('requires-full-update');
      }
    };

    try {
      setProgress({ phase: 'install', message: 'Checking the runner and extensions…' });
      const parts = await api().invoke('app.checkComponents');
      setComponents(parts);
      if (parts.error) {
        setCliError(`The runner and extensions stay as they are: ${parts.error}`);
      } else if (parts.available) {
        const r = await api().invoke('app.updateComponents');
        if (!r.ok) {
          setError(failed(r.error));
          setState('error');
          return;
        }
        installed = r.updated;
      }

      setProgress({ phase: 'download', message: 'Checking for app updates…' });
      const c = await api().invoke('app.checkUpdate');
      setCheck(c);
      if (!c.error && c.available) {
        if (c.requiresFullUpdate || !c.compatible) {
          await fullInstaller();
          return;
        }
        const u = await api().invoke('app.updateDashboard');
        if (u.ok && u.version) {
          setStagedVersion(u.version);
          installed = true;
        } else if (u.requiresFullUpdate) {
          await fullInstaller();
          return;
        } else if (!installed) {
          setError(failed(u.error));
          setState('error');
          return;
        }
      }

      if (installed) await relaunchOntoUpdate();
      else setState('uptodate');
    } catch (e) {
      setError(failed(toErrorMessage(e)));
      setState('error');
    }
  }, []);

  const loadDiagnostics = useCallback(async (): Promise<void> => {
    try {
      setDiagnostics(await api().invoke('app.updateDiagnostics'));
    } catch {
      setDiagnostics(null);
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

  return {
    info,
    check,
    components,
    state,
    progress,
    error,
    stagedVersion,
    diagnostics,
    cliInfo,
    cliError,
    runCheck,
    runUpdate,
    runShellUpdate,
    runUpdateAll,
    loadDiagnostics,
    relaunch,
  };
}
