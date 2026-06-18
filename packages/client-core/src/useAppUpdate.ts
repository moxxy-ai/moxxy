/**
 * Renderer-side state machine for the self-update flow, shared by the
 * Settings → Update panel and the launch banner.
 *
 * Drives the dashboard IPC commands (`app.updateInfo` / `app.checkUpdate` /
 * `app.updateDashboard` / `app.updateShell`) plus the runner commands
 * (`app.cliInfo` / `app.updateCli`), and subscribes to `app.update.progress`
 * so the UI can show a bar while a bundle downloads. The actual
 * download/verify/install all happen main-side; this only orchestrates and
 * reflects status.
 *
 * The unified {@link UseAppUpdate.runUpdateAll} brings BOTH the runner and the
 * desktop app to latest in a single action — the one "Update" the settings UI
 * exposes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppUpdateCheck,
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
  state: UpdateState;
  progress: AppUpdateProgress | null;
  error: string | null;
  stagedVersion: string | null;
  diagnostics: AppUpdateDiagnostics | null;
  /** Version + on-disk path of the moxxy CLI ("runner") the desktop spawns,
   *  fetched on mount via `app.cliInfo`. Either field may be null if it can't
   *  be resolved. */
  cliInfo: { version: string | null; path: string | null } | null;
  /** Non-fatal note when the runner update was skipped/failed during
   *  {@link runUpdateAll} (e.g. npm not on PATH). The bundled CLI keeps
   *  working, so this never blocks the app update. */
  cliError: string | null;
  runCheck: () => Promise<void>;
  runUpdate: () => Promise<void>;
  /** Tier-2: download the FULL installer and quit into it (`app.updateShell`).
   *  For `requires-full-update` / `incompatible` releases a hot-update can't
   *  deliver. On success the app quits mid-call; on failure the state returns
   *  to the CTA with `error` set so the UI can offer the release page. */
  runShellUpdate: () => Promise<void>;
  /** The ONE unified update: bring BOTH the runner (`@moxxy/cli`) and the
   *  desktop app to latest in a single action. The runner restarts live; the
   *  desktop bundle stages and applies on relaunch (or quits into a full
   *  installer when a hot-update can't deliver). See the implementation for
   *  the live-vs-relaunch distinction. */
  runUpdateAll: () => Promise<void>;
  loadDiagnostics: () => Promise<void>;
  relaunch: () => void;
}

export function useAppUpdate(opts: { autoCheck?: boolean } = {}): UseAppUpdate {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [check, setCheck] = useState<AppUpdateCheck | null>(null);
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
      const c = await api().invoke('app.checkUpdate');
      setCheck(c);
      if (c.error) setState('unavailable');
      else if (!c.available) setState('uptodate');
      else if (c.requiresFullUpdate) setState('requires-full-update');
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
   * The single unified update flow: bring BOTH the runner and the desktop app
   * to latest in one action.
   *
   * Two very different delivery models are composed here:
   *   - The RUNNER (`@moxxy/cli`) updates LIVE: `app.updateCli` installs the
   *     latest published CLI into the writable userData copy and restarts every
   *     runner, so the new binary is in use immediately — no relaunch needed.
   *     If it fails (e.g. npm not on PATH) the bundled CLI keeps working, so a
   *     runner failure is recorded in `cliError` but is NON-FATAL: we continue
   *     to the app update, which is independent and still valuable.
   *   - The DESKTOP bundle stages and applies on the NEXT LAUNCH (a hot-update),
   *     or — when the published bundle can't apply as a hot-update (its runner
   *     protocol outruns the spawnable CLI, or the shell/ABI is incompatible) —
   *     the full installer is downloaded and the app QUITS into it (Tier-2).
   */
  const runUpdateAll = useCallback(async (): Promise<void> => {
    setState('updating');
    setError(null);
    setCliError(null);
    setProgress(null);

    // 1) Runner first — updates live, non-fatal on failure.
    setProgress({ phase: 'install', message: 'Updating the runner…' });
    try {
      const r = await api().invoke('app.updateCli');
      if (r.code !== 0) {
        setCliError(`Runner update skipped: npm install exited with code ${r.code}.`);
      } else {
        // The runner restarted live with the new CLI; reflect the new version.
        setCliInfo((cur) => ({ version: r.version, path: cur?.path ?? null }));
      }
    } catch (e) {
      setCliError(`Runner update skipped: ${toErrorMessage(e)}`);
    }

    // 2) Desktop app — independent of the runner result above.
    setProgress({ phase: 'download', message: 'Checking for app updates…' });
    try {
      const c = await api().invoke('app.checkUpdate');
      setCheck(c);

      if (c.error) {
        // Update channel unavailable (offline / not configured / bad sig). The
        // app stays as-is; the runner may still have updated. Reflect that the
        // app is current as far as we can act on it.
        setState('uptodate');
        return;
      }
      if (!c.available) {
        // App already current. (The runner may still have been updated above —
        // that's fine, it restarts live and `cliInfo`/`cliError` reflect it.)
        setState('uptodate');
        return;
      }

      if (c.requiresFullUpdate || !c.compatible) {
        // Can't hot-update — download the full installer and quit into it.
        // Mirrors runShellUpdate: on success the app quits mid-call; on failure
        // drop to the requires-full-update CTA with `error` so the release-page
        // fallback stays reachable.
        const s = await api().invoke('app.updateShell');
        if (s.ok) {
          setProgress({ phase: 'install', message: 'Restarting to install…' });
        } else {
          setError(s.error ?? 'Full update failed.');
          setState('requires-full-update');
        }
        return;
      }

      // Available + compatible → hot-update the dashboard bundle.
      const u = await api().invoke('app.updateDashboard');
      if (u.ok && u.version) {
        setStagedVersion(u.version);
        setState('staged');
      } else if (u.requiresFullUpdate) {
        // The bundle was deliberately not staged — fall through to the full
        // installer (same Tier-2 path as above).
        const s = await api().invoke('app.updateShell');
        if (s.ok) {
          setProgress({ phase: 'install', message: 'Restarting to install…' });
        } else {
          setError(s.error ?? 'Full update failed.');
          setState('requires-full-update');
        }
      } else {
        setError(u.error ?? 'Update failed.');
        setState('error');
      }
    } catch (e) {
      // A throw here is a fatal app-update error (the runner result, if any, is
      // still reflected via cliInfo/cliError as a secondary note).
      setError(toErrorMessage(e));
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
