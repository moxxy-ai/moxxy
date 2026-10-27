import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';

export interface VaultKeyState {
  readonly loading: boolean;
  /** The key is saved in this device's vault; its value is never read back. */
  readonly hasKey: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setDraft: (value: string) => void;
  readonly save: () => Promise<void>;
}

/** One API key in the vault, saved once and shared by every feature that uses
 *  it (e.g. `OPENAI_API_KEY` for GPT-Live, transcription and the provider). */
export function useVaultKey(name: string): VaultKeyState {
  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api().invoke('settings.vaultEntries').then((entries) => {
      if (current) setHasKey(entries.some((entry) => entry.name === name));
    }).catch((reason: unknown) => {
      if (current) setError(errorMessage(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [name]);

  const save = useCallback(async () => {
    const value = draft.trim();
    if (!value) {
      setError('Paste an API key first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api().invoke('settings.vaultSet', { name, value });
      setHasKey(true);
      setDraft('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [draft, name]);

  return { loading, hasKey, draft, busy, error, setDraft, save };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
