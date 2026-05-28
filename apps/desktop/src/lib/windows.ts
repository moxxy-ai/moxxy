import { useCallback, useState } from 'react';
import { invoke } from './tauri';

export interface WindowsApi {
  readonly opening: boolean;
  readonly error: string | null;
  /** Open a new parallel-session window. Returns the new window's label. */
  readonly openSession: () => Promise<string | null>;
  readonly close: (label: string) => Promise<void>;
}

/**
 * Hook over the multi-window commands. Stays minimal — the heavy
 * lifting is in Rust; the JS side just wraps the call + tracks the
 * "opening" status so the UI can disable the button while a spawn is
 * in flight (ephemeral runners take ~500ms to boot).
 */
export function useWindows(): WindowsApi {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openSession = useCallback(async (): Promise<string | null> => {
    if (opening) return null;
    setOpening(true);
    setError(null);
    try {
      const label = await invoke<string>('open_session_window');
      return label;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setOpening(false);
    }
  }, [opening]);

  const close = useCallback(async (label: string): Promise<void> => {
    try {
      await invoke('close_session_window', { window: label });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { opening, error, openSession, close };
}
