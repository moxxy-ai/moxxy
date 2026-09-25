import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { GeminiTtsUsageSnapshot, GeminiVoiceInfo } from '@moxxy/desktop-ipc-contract';

const GEMINI_API_KEY = 'GEMINI_API_KEY';

export interface VoiceSettingsState {
  readonly loading: boolean;
  readonly backend: string | null;
  readonly hasGeminiKey: boolean;
  readonly apiKeyDraft: string;
  readonly voices: ReadonlyArray<GeminiVoiceInfo>;
  readonly usage: GeminiTtsUsageSnapshot | null;
  readonly loadingUsage: boolean;
  readonly selectedVoiceId: string;
  readonly localPiperInstalled: boolean;
  readonly loadingVoices: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setApiKeyDraft: (value: string) => void;
  readonly setSelectedVoiceId: (value: string) => void;
  readonly saveGeminiApiKey: () => Promise<void>;
  readonly loadVoices: () => Promise<void>;
  readonly refreshUsage: () => Promise<void>;
  readonly useGeminiVoice: () => Promise<void>;
  readonly useLocalPiper: () => Promise<void>;
}

/** Owns IPC and async state for Settings → Voice; the view only renders and
 *  forwards user actions. API-key values are never read back from the vault. */
export function useVoiceSettings(): VoiceSettingsState {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<string | null>(null);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [voices, setVoices] = useState<ReadonlyArray<GeminiVoiceInfo>>([]);
  const [usage, setUsage] = useState<GeminiTtsUsageSnapshot | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [selectedVoiceId, setSelectedVoiceId] = useState('Fola');
  const [localPiperInstalled, setLocalPiperInstalled] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshUsage = useCallback(async () => {
    setLoadingUsage(true);
    try {
      setUsage(await api().invoke('voice.getUsage'));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingUsage(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      api().invoke('voice.getSettings'),
      api().invoke('settings.vaultEntries'),
      api().invoke('voice.isLocalPiperInstalled'),
    ]).then(([settings, entries, installed]) => {
      if (!current) return;
      setBackend(settings.backend);
      setSelectedVoiceId(settings.voiceId);
      setHasGeminiKey(entries.some((entry) => entry.name === GEMINI_API_KEY));
      setLocalPiperInstalled(installed);
    }).catch((reason: unknown) => {
      if (current) setError(errorMessage(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => { void refreshUsage(); }, [refreshUsage]);

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true);
    setError(null);
    try {
      const result = await api().invoke('voice.listGeminiVoices');
      setVoices(result);
      if (result.length > 0 && !result.some((voice) => voice.id === selectedVoiceId)) {
        setSelectedVoiceId(result[0]?.id ?? selectedVoiceId);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingVoices(false);
    }
  }, [selectedVoiceId]);

  const saveGeminiApiKey = useCallback(async () => {
    if (!apiKeyDraft.trim()) {
      setError('Paste a Gemini API key first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api().invoke('settings.vaultSet', { name: GEMINI_API_KEY, value: apiKeyDraft.trim() });
      setHasGeminiKey(true);
      setApiKeyDraft('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [apiKeyDraft]);

  const useGeminiVoice = useCallback(async () => {
    if (!hasGeminiKey) {
      setError('Add a Gemini API key before selecting the cloud voice.');
      return;
    }
    if (!selectedVoiceId) {
      setError('Load the voice library and select a voice first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api().invoke('voice.useGeminiTts', { voiceId: selectedVoiceId });
      setBackend('gemini-tts');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, [hasGeminiKey, selectedVoiceId]);

  const useLocalPiper = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api().invoke('voice.useLocalPiper');
      setBackend('local-piper');
      setLocalPiperInstalled(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    loading,
    backend,
    hasGeminiKey,
    apiKeyDraft,
    voices,
    usage,
    loadingUsage,
    selectedVoiceId,
    localPiperInstalled,
    loadingVoices,
    busy,
    error,
    setApiKeyDraft,
    setSelectedVoiceId,
    saveGeminiApiKey,
    loadVoices,
    refreshUsage,
    useGeminiVoice,
    useLocalPiper,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
