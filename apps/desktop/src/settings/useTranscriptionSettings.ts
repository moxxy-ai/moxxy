import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type {
  LocalTranscriptionModelId,
  LocalTranscriptionModelState,
  TranscriptionChoice,
  TranscriptionSettings,
  TranscriptionSetup,
} from '@moxxy/desktop-ipc-contract';

export interface TranscriptionSettingsState {
  readonly loading: boolean;
  /** What turns speech into text: a local model, or `cloud` for OpenAI. */
  readonly choice: TranscriptionChoice;
  /** The transcriber the runner actually runs, `null` when none. */
  readonly active: string | null;
  readonly models: ReadonlyArray<LocalTranscriptionModelState>;
  /** How far getting a model ready has come, while the host does it. */
  readonly setup: TranscriptionSetup | null;
  /** What a running switch moves to. */
  readonly switching: TranscriptionChoice | null;
  readonly error: string | null;
  /** The model the last attempt failed on, so its row can offer to try again. */
  readonly failed: LocalTranscriptionModelId | null;
  /** Download a missing model, then switch to it. */
  readonly choose: (next: TranscriptionChoice) => Promise<void>;
  /** Stop the model download; the choice stays as it was. */
  readonly cancel: () => Promise<void>;
  readonly remove: (model: LocalTranscriptionModelId) => Promise<void>;
}

/** Owns IPC and async state for the dictation models in Settings → Voice. The
 *  host runs the switch and reports it on `voice.transcription.changed`, so a
 *  download keeps going, and shows again here, when the person leaves the tab. */
export function useTranscriptionSettings(): TranscriptionSettingsState {
  const [settings, setSettings] = useState<TranscriptionSettings | null>(null);
  const [requested, setRequested] = useState<TranscriptionChoice | null>(null);
  const [failed, setFailed] = useState<LocalTranscriptionModelId | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

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

  const choice = settings?.choice ?? 'cloud';
  const setup = settings?.setup ?? null;
  const switching = setup ? setup.model : requested;

  const choose = useCallback(async (next: TranscriptionChoice) => {
    if (!settings || next === choice || switching) return;
    setRequested(next);
    setFailed(null);
    setRequestError(null);
    try {
      if (next === 'cloud') await api().invoke('voice.useCloudTranscription');
      else await api().invoke('voice.useLocalTranscription', { model: next });
    } catch (reason) {
      setRequestError(errorMessage(reason));
      if (next !== 'cloud') setFailed(next);
    } finally {
      // Either way, show what the host now runs: a failed switch stays where it was.
      await refresh().catch(() => undefined);
      setRequested(null);
    }
  }, [settings, choice, switching, refresh]);

  const cancel = useCallback(async () => {
    await api().invoke('voice.cancelLocalTranscription').catch((reason: unknown) => {
      setRequestError(errorMessage(reason));
    });
  }, []);

  const remove = useCallback(async (model: LocalTranscriptionModelId) => {
    setRequestError(null);
    await api().invoke('voice.removeLocalTranscriptionModel', { model }).catch((reason: unknown) => {
      setRequestError(errorMessage(reason));
    });
    await refresh().catch(() => undefined);
  }, [refresh]);

  return {
    loading: settings === null && requestError === null,
    choice,
    active: settings?.active ?? null,
    models: settings?.models ?? [],
    setup,
    switching,
    error: requestError ?? settings?.error ?? null,
    failed,
    choose,
    cancel,
    remove,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
