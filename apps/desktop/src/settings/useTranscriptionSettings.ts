import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { TranscriptionMode, TranscriptionSettings, TranscriptionSetup } from '@moxxy/desktop-ipc-contract';

export interface TranscriptionSettingsState {
  readonly loading: boolean;
  /** Where speech is transcribed: in the cloud or on this computer. */
  readonly mode: TranscriptionMode;
  /** The transcriber the runner actually runs, `null` when none. */
  readonly active: string | null;
  /** Whisper turbo is on this computer, so Local downloads nothing. */
  readonly modelReady: boolean;
  /** The model's download size in bytes. */
  readonly modelBytes: number;
  /** How far getting Local ready has come, while the host does it. */
  readonly setup: TranscriptionSetup | null;
  /** The mode a running switch moves to. */
  readonly switching: TranscriptionMode | null;
  readonly error: string | null;
  /** Asking whether to download the model, before the first switch to Local. */
  readonly confirmingDownload: boolean;
  readonly choose: (mode: TranscriptionMode) => Promise<void>;
  readonly confirmDownload: () => Promise<void>;
  readonly dismissDownload: () => void;
  /** Stop the model download; Moxxy stays on Cloud. */
  readonly cancel: () => Promise<void>;
}

/** Owns IPC and async state for the Transcription choice in Settings → Voice.
 *  The host runs the switch and reports it on `voice.transcription.changed`, so
 *  a download keeps going, and shows again here, when the person leaves the tab. */
export function useTranscriptionSettings(): TranscriptionSettingsState {
  const [settings, setSettings] = useState<TranscriptionSettings | null>(null);
  const [requested, setRequested] = useState<TranscriptionMode | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmingDownload, setConfirmingDownload] = useState(false);

  const refresh = useCallback(async () => {
    setSettings(await api().invoke('voice.getTranscription'));
  }, []);

  useEffect(() => {
    let current = true;
    const off = api().subscribe('voice.transcription.changed', (next: TranscriptionSettings) => {
      if (current) setSettings(next);
    });
    void api().invoke('voice.getTranscription').then((next) => {
      if (current) setSettings(next);
    }).catch((reason: unknown) => {
      if (current) setRequestError(errorMessage(reason));
    });
    return () => {
      current = false;
      off();
    };
  }, []);

  const mode = settings?.mode ?? 'cloud';
  const setup = settings?.setup ?? null;
  const switching: TranscriptionMode | null = setup ? 'local' : requested;

  const run = useCallback(async (next: TranscriptionMode) => {
    setRequested(next);
    setRequestError(null);
    try {
      await api().invoke(next === 'local' ? 'voice.useLocalTranscription' : 'voice.useCloudTranscription');
    } catch (reason) {
      setRequestError(errorMessage(reason));
    } finally {
      // Either way, show what the host now runs: a failed Local stays on Cloud.
      await refresh().catch(() => undefined);
      setRequested(null);
    }
  }, [refresh]);

  const choose = useCallback(async (next: TranscriptionMode) => {
    if (!settings || next === mode || switching) return;
    if (next === 'local' && !settings.modelReady) {
      setConfirmingDownload(true);
      return;
    }
    await run(next);
  }, [settings, mode, switching, run]);

  const confirmDownload = useCallback(async () => {
    setConfirmingDownload(false);
    await run('local');
  }, [run]);

  const dismissDownload = useCallback(() => setConfirmingDownload(false), []);

  const cancel = useCallback(async () => {
    await api().invoke('voice.cancelLocalTranscription').catch((reason: unknown) => {
      setRequestError(errorMessage(reason));
    });
  }, []);

  return {
    loading: settings === null && requestError === null,
    mode,
    active: settings?.active ?? null,
    modelReady: settings?.modelReady ?? false,
    modelBytes: settings?.modelBytes ?? 0,
    setup,
    switching,
    error: settings?.error ?? requestError,
    confirmingDownload,
    choose,
    confirmDownload,
    dismissDownload,
    cancel,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
