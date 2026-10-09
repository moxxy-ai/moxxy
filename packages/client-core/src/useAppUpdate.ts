/**
 * Renderer-side state machine for the self-update flow, shared by the
 * Settings → Update panel and the launch banner.
 *
 * Drives the update IPC commands and subscribes to `app.update.progress` and
 * `app.update.plan` so the UI can show progress. The download, verification
 * and install all happen main-side; this only asks and reflects status.
 *
 * The unified {@link UseAppUpdate.runUpdateAll} is the one "Update" people
 * click. The host owns it (`app.updateAll`): it decides the steps, carries
 * them out and restarts — no second step, nothing to decide.
 *
 * An update is offered for a new release of the app only. The runner and the
 * extensions are not released to people on their own: the launch after an app
 * update brings them to the version that app was built with.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { appUpdatePlanState } from '@moxxy/desktop-ipc-contract';
import type {
  AppUpdateCheck,
  AppUpdatePlan,
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
  /** Whether the runner or extensions are behind the version this app was
   *  built with; read with the diagnostics (`loadDiagnostics`). */
  components: ComponentUpdateCheck | null;
  /** {@link UseAppUpdate.runComponentsUpdate} is running. */
  componentsBusy: boolean;
  /** The update being carried out, or the last one as this launch found it. */
  plan: AppUpdatePlan | null;
  state: UpdateState;
  progress: AppUpdateProgress | null;
  error: string | null;
  stagedVersion: string | null;
  diagnostics: AppUpdateDiagnostics | null;
  /** Version + on-disk path of the moxxy CLI ("runner") the desktop spawns,
   *  fetched on mount via `app.cliInfo`. Either field may be null if it can't
   *  be resolved. */
  cliInfo: { version: string | null; path: string | null } | null;
  /** Why {@link UseAppUpdate.runComponentsUpdate} could not bring the runner
   *  and extensions up (e.g. npm not on PATH). The installed ones keep working. */
  cliError: string | null;
  runCheck: () => Promise<void>;
  runUpdate: () => Promise<void>;
  /** Tier-2: download the FULL installer and quit into it (`app.updateShell`).
   *  For `requires-full-update` / `incompatible` releases a hot-update can't
   *  deliver. On success the app quits mid-call; on failure the state returns
   *  to the CTA with `error` set so the UI can offer the release page. */
  runShellUpdate: () => Promise<void>;
  /** The ONE update people click: the host installs the new app and restarts
   *  onto it. A step that fails stops the update there and leaves `error` set
   *  for another try. */
  runUpdateAll: () => Promise<void>;
  /** By hand, for when the launch after an update could not do it: brings the
   *  runner and extensions to the version this app was built with. */
  runComponentsUpdate: () => Promise<void>;
  loadDiagnostics: () => Promise<void>;
  relaunch: () => void;
}

const updateFailed = (detail?: string): string =>
  `The update could not be finished; Moxxy works as before.${detail ? ` (${detail})` : ''}`;

/** What to tell the user about a plan that failed, or null when it did not. */
function planFailure(plan: AppUpdatePlan): string | null {
  if (appUpdatePlanState(plan) !== 'failed') return null;
  return updateFailed(plan.steps.find((step) => step.status === 'failed')?.error);
}

export function useAppUpdate(opts: { autoCheck?: boolean } = {}): UseAppUpdate {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [check, setCheck] = useState<AppUpdateCheck | null>(null);
  const [components, setComponents] = useState<ComponentUpdateCheck | null>(null);
  const [plan, setPlan] = useState<AppUpdatePlan | null>(null);
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stagedVersion, setStagedVersion] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<AppUpdateDiagnostics | null>(null);
  const [cliInfo, setCliInfo] = useState<{ version: string | null; path: string | null } | null>(
    null,
  );
  const [cliError, setCliError] = useState<string | null>(null);
  const [componentsBusy, setComponentsBusy] = useState(false);
  const autoChecked = useRef(false);

  useEffect(() => {
    void api()
      .invoke('app.updateInfo')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  // The runner (CLI) version shown alongside the app/dashboard version: the
  // unified panel surfaces BOTH. Mirrors how `info` is fetched on mount.
  const loadCliInfo = useCallback(
    (): Promise<void> =>
      api()
        .invoke('app.cliInfo')
        .then(setCliInfo)
        .catch(() => setCliInfo({ version: null, path: null })),
    [],
  );
  useEffect(() => {
    void loadCliInfo();
  }, [loadCliInfo]);

  useEffect(() => {
    const off = api().subscribe('app.update.progress', (p: AppUpdateProgress) => setProgress(p));
    return off;
  }, []);

  useEffect(() => api().subscribe('app.update.plan', setPlan), []);

  const runCheck = useCallback(async (): Promise<void> => {
    setState('checking');
    setError(null);
    try {
      const [c, last] = await Promise.all([
        api().invoke('app.checkUpdate'),
        api().invoke('app.updatePlan').catch(() => null),
      ]);
      setCheck(c);
      setPlan(last);
      const appAvailable = !c.error && c.available;
      // An update that failed or did not survive its restart is said so, for
      // as long as it is still on offer.
      if (appAvailable && last) setError(planFailure(last));
      if (appAvailable && c.requiresFullUpdate) setState('requires-full-update');
      else if (appAvailable && !c.compatible) setState('incompatible');
      else if (appAvailable) setState('available');
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
   * The one "Update". The host decides what it takes (the app bundle or the
   * full installer), does it and restarts; a step that fails stops it there
   * with the running app untouched.
   */
  const runUpdateAll = useCallback(async (): Promise<void> => {
    setState('updating');
    setError(null);
    setProgress(null);
    try {
      const r = await api().invoke('app.updateAll');
      setPlan(r.plan);
      if (!r.ok) {
        setError(updateFailed(r.error));
        // The installer failing leaves the release page as the way through.
        setState(r.plan?.route === 'installer' ? 'requires-full-update' : 'error');
        return;
      }
      if (!r.plan) {
        setState('uptodate');
        return;
      }
      setStagedVersion(r.plan.version);
      setState('staged');
      setProgress({
        phase: 'install',
        message: r.plan.route === 'installer' ? 'Restarting to install…' : 'Restarting Moxxy…',
      });
    } catch (e) {
      setError(updateFailed(toErrorMessage(e)));
      setState('error');
    }
  }, []);

  const loadComponents = useCallback(
    (): Promise<void> =>
      api()
        .invoke('app.checkComponents')
        .then(setComponents)
        .catch(() => setComponents(null)),
    [],
  );

  const loadDiagnostics = useCallback(async (): Promise<void> => {
    void loadComponents();
    try {
      setDiagnostics(await api().invoke('app.updateDiagnostics'));
    } catch {
      setDiagnostics(null);
    }
  }, [loadComponents]);

  const runComponentsUpdate = useCallback(async (): Promise<void> => {
    setComponentsBusy(true);
    setCliError(null);
    try {
      const r = await api().invoke('app.updateComponents');
      if (!r.ok) setCliError(`The runner and extensions stay as they are: ${r.error ?? 'the update failed.'}`);
    } catch (e) {
      setCliError(`The runner and extensions stay as they are: ${toErrorMessage(e)}`);
    } finally {
      await Promise.all([loadCliInfo(), loadComponents()]);
      setComponentsBusy(false);
    }
  }, [loadCliInfo, loadComponents]);

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
    componentsBusy,
    plan,
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
    runComponentsUpdate,
    loadDiagnostics,
    relaunch,
  };
}
