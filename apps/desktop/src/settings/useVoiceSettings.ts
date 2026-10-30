import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { GeminiVoiceInfo } from '@moxxy/desktop-ipc-contract';
import { useVaultKey } from './useVaultKey';

const GEMINI_API_KEY = 'GEMINI_API_KEY';

export interface VoiceSettingsState {
  readonly loading: boolean;
  readonly backend: string | null;
  readonly hasGeminiKey: boolean;
  readonly apiKeyDraft: string;
  readonly voices: ReadonlyArray<GeminiVoiceInfo>;
  readonly selectedVoiceId: string;
  readonly loadingVoices: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setApiKeyDraft: (value: string) => void;
  readonly setSelectedVoiceId: (value: string) => void;
  readonly saveGeminiApiKey: () => Promise<void>;
  readonly loadVoices: () => Promise<void>;
  readonly useGeminiVoice: () => Promise<void>;
  readonly useLocalVoice: () => Promise<void>;
}

/** Owns IPC and async state for Settings → Voice; the view only renders and
 *  forwards user actions. API-key values are never read back from the vault. */
export function useVoiceSettings(): VoiceSettingsState {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<string | null>(null);
  const geminiKey = useVaultKey(GEMINI_API_KEY);
  const hasGeminiKey = geminiKey.hasKey;
  const [voices, setVoices] = useState<ReadonlyArray<GeminiVoiceInfo>>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('Fola');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void api().invoke('voice.getSettings').then((settings) => {
      if (!current) return;
      setBackend(settings.backend);
      setSelectedVoiceId(settings.voiceId);
    }).catch((reason: unknown) => {
      if (current) setError(errorMessage(reason));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, []);

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

  const useLocalVoice = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api().invoke('voice.useLocalVoice');
      setBackend('local-supertonic');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    loading: loading || geminiKey.loading,
    backend,
    hasGeminiKey,
    apiKeyDraft: geminiKey.draft,
    voices,
    selectedVoiceId,
    loadingVoices,
    busy: busy || geminiKey.busy,
    error: error ?? geminiKey.error,
    setApiKeyDraft: geminiKey.setDraft,
    setSelectedVoiceId,
    saveGeminiApiKey: geminiKey.save,
    loadVoices,
    useGeminiVoice,
    useLocalVoice,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
