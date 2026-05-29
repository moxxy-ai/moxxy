import { useCallback, useEffect, useState } from 'react';
import { invoke, subscribe } from './tauri';

/**
 * Mirror of `moxxy_desktop_core::requirements`. The Rust side is
 * authoritative; we restate the shape here so the React tree gets
 * static types without a build-time codegen step.
 */
export type RequirementKind = 'node' | 'moxxy-cli' | 'provider-key';

export type InstallHint =
  | {
      readonly kind: 'command';
      readonly program: string;
      readonly args: ReadonlyArray<string>;
      readonly label: string;
    }
  | {
      readonly kind: 'open-url';
      readonly url: string;
      readonly label: string;
    };

export interface RequirementCheck {
  readonly kind: RequirementKind;
  readonly satisfied: boolean;
  readonly detail?: string;
  readonly install?: InstallHint;
}

export interface RequirementsStatus {
  readonly allMet: boolean;
  readonly checks: ReadonlyArray<RequirementCheck>;
}

/**
 * One Rust→React install-progress event line. The Rust side calls
 * `app.emit("requirements.install.progress", line)` for every stdout
 * and stderr line plus a marker `$ program args` header.
 */
export interface InstallProgressLine {
  readonly line: string;
  readonly at: number;
}

export interface InstallController {
  readonly running: boolean;
  readonly progress: ReadonlyArray<InstallProgressLine>;
  readonly lastExitCode: number | null;
  readonly error: string | null;
  readonly run: (hint: InstallHint) => Promise<number | null>;
  readonly reset: () => void;
}

export interface RequirementsApi {
  readonly status: RequirementsStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly install: InstallController;
}

function normalize(raw: unknown): RequirementsStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    all_met?: boolean;
    allMet?: boolean;
    checks?: ReadonlyArray<RequirementCheck>;
  };
  return {
    allMet: r.allMet ?? r.all_met ?? false,
    checks: r.checks ?? [],
  };
}

/**
 * Detect missing system requirements + drive their install. The hook
 * subscribes to the Rust-side progress events so an in-flight install
 * streams to the UI, then refreshes status when the install finishes
 * so the checklist reflects the new state.
 */
export function useRequirements(): RequirementsApi {
  const [status, setStatus] = useState<RequirementsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<InstallProgressLine[]>([]);
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await invoke<unknown>('requirements_check');
      setStatus(normalize(raw));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubs = [
      subscribe<string>('requirements.install.progress', (line) => {
        setProgress((prev) => [
          ...prev.slice(-499), // keep ring bounded
          { line, at: Date.now() },
        ]);
      }),
      subscribe<{ code: number }>('requirements.install.done', () => {
        // Final code arrives from the invoke() promise too; this event
        // is for streaming consumers that want a heartbeat without
        // awaiting the round-trip.
      }),
    ];
    return () => {
      for (const u of unsubs) void u.then((fn) => fn());
    };
  }, []);

  const run = useCallback(
    async (hint: InstallHint): Promise<number | null> => {
      setInstalling(true);
      setInstallError(null);
      setProgress([]);
      setLastExitCode(null);
      try {
        const code = await invoke<number>('requirements_install', { hint });
        setLastExitCode(code);
        // Re-detect so the requirement row flips green if the install
        // landed correctly (npm i -g moxxy/cli puts it on PATH).
        await refresh();
        return code;
      } catch (e) {
        setInstallError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setInstalling(false);
      }
    },
    [refresh],
  );

  const reset = useCallback(() => {
    setProgress([]);
    setLastExitCode(null);
    setInstallError(null);
  }, []);

  return {
    status,
    loading,
    error,
    refresh,
    install: {
      running: installing,
      progress,
      lastExitCode,
      error: installError,
      run,
      reset,
    },
  };
}
