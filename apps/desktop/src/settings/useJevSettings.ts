import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';

/** The vault names `@moxxy/plugin-computer-control` reads: the TypeSafe key, and the entry that switches Jev off. */
const JEV_KEY = 'TYPESAFE_API_KEY';
const JEV_OFF = 'JEV_DISABLED';

export interface JevSettingsState {
  readonly loading: boolean;
  readonly hasKey: boolean;
  /** Jev takes part in Computer Use: a key is stored and the switch is on. */
  readonly enabled: boolean;
  /** The key field is open: there is no key yet, or the stored one is being changed. */
  readonly editing: boolean;
  readonly keyDraft: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setKeyDraft: (value: string) => void;
  readonly saveKey: () => Promise<void>;
  readonly changeKey: () => void;
  readonly cancelChange: () => void;
  readonly setEnabled: (on: boolean) => Promise<void>;
}

/** Owns IPC and async state for Settings → Jev. Both the key and the switch live in the
 *  vault, the one store every surface and the plugin read; the key is never read back. */
export function useJevSettings(): JevSettingsState {
  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [off, setOff] = useState(false);
  const [changing, setChanging] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api().invoke('settings.vaultEntries').then((entries) => {
      if (!current) return;
      setHasKey(entries.some((entry) => entry.name === JEV_KEY));
      setOff(entries.some((entry) => entry.name === JEV_OFF));
    }).catch((reason: unknown) => {
      if (current) setError(errorMessage(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, []);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveKey = useCallback(async () => {
    const value = keyDraft.trim();
    if (!value) {
      setError('Paste a TypeSafe API key first.');
      return;
    }
    await run(async () => {
      await api().invoke('settings.vaultSet', { name: JEV_KEY, value });
      setHasKey(true);
      setChanging(false);
      setKeyDraft('');
    });
  }, [keyDraft, run]);

  const setEnabled = useCallback((on: boolean) => run(async () => {
    if (on) await api().invoke('settings.vaultDelete', { name: JEV_OFF });
    else await api().invoke('settings.vaultSet', { name: JEV_OFF, value: '1' });
    setOff(!on);
  }), [run]);

  const changeKey = useCallback(() => setChanging(true), []);
  const cancelChange = useCallback(() => {
    setChanging(false);
    setKeyDraft('');
    setError(null);
  }, []);

  return {
    loading,
    hasKey,
    enabled: hasKey && !off,
    editing: !hasKey || changing,
    keyDraft,
    busy,
    error,
    setKeyDraft,
    saveKey,
    changeKey,
    cancelChange,
    setEnabled,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
