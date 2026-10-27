import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { TranscriptionSettings } from '@moxxy/desktop-ipc-contract';
import { useTranscriptionSettings } from './useTranscriptionSettings';

afterEach(() => __setApiOverride(null));

const CLOUD: TranscriptionSettings = {
  mode: 'cloud',
  active: 'openai-gpt-transcribe',
  modelReady: false,
  modelBytes: 1_036_613_791,
  setup: null,
  error: null,
};
const LOCAL: TranscriptionSettings = { ...CLOUD, mode: 'local', active: 'local-whisper', modelReady: true };

/**
 * Desktop IPC to the main process is the one boundary stood in here: `current`
 * is what the host reports, `push` sends a `voice.transcription.changed`.
 */
function installApi(
  initial: TranscriptionSettings,
  onSwitch: (command: string) => Promise<TranscriptionSettings> = async (command) => (
    command === 'voice.useLocalTranscription' ? LOCAL : { ...CLOUD, modelReady: true }
  ),
) {
  let current = initial;
  let changed: (settings: TranscriptionSettings) => void = () => undefined;
  const invoke = vi.fn(async (command: string) => {
    if (command === 'voice.getTranscription') return current;
    if (command === 'voice.useLocalTranscription' || command === 'voice.useCloudTranscription') {
      current = await onSwitch(command);
    }
    return undefined;
  });
  __setApiOverride({
    invoke,
    subscribe: (channel: string, handler: (settings: TranscriptionSettings) => void) => {
      if (channel === 'voice.transcription.changed') changed = handler;
      return () => undefined;
    },
  } as never);
  return {
    invoke,
    push: (settings: TranscriptionSettings) => {
      current = settings;
      act(() => changed(settings));
    },
  };
}

async function rendered() {
  const view = renderHook(() => useTranscriptionSettings());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe('useTranscriptionSettings', () => {
  it('reads where speech is transcribed, what the runner runs and whether the model is here', async () => {
    installApi(CLOUD);
    const { result } = await rendered();

    expect(result.current).toMatchObject({
      mode: 'cloud',
      active: 'openai-gpt-transcribe',
      modelReady: false,
      modelBytes: 1_036_613_791,
      setup: null,
      switching: null,
      error: null,
      confirmingDownload: false,
    });
  });

  it('asks before the first switch to Local, which downloads the model', async () => {
    const { invoke } = installApi(CLOUD);
    const { result } = await rendered();

    await act(async () => result.current.choose('local'));

    expect(result.current.confirmingDownload).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');

    await act(async () => result.current.confirmDownload());
    expect(result.current.confirmingDownload).toBe(false);
    expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription');
    await waitFor(() => expect(result.current.mode).toBe('local'));
  });

  it('downloads nothing when the person says not now', async () => {
    const { invoke } = installApi(CLOUD);
    const { result } = await rendered();

    await act(async () => result.current.choose('local'));
    act(() => result.current.dismissDownload());

    expect(result.current.confirmingDownload).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');
  });

  it('switches straight to Local when the model is already here', async () => {
    const { invoke } = installApi({ ...CLOUD, modelReady: true });
    const { result } = await rendered();

    await act(async () => result.current.choose('local'));

    expect(result.current.confirmingDownload).toBe(false);
    expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription');
  });

  it('follows the download the host reports, wherever it was started', async () => {
    const { push } = installApi(CLOUD);
    const { result } = await rendered();

    push({ ...CLOUD, setup: { phase: 'downloading', receivedBytes: 300_000_000, totalBytes: 1_036_613_791 } });

    expect(result.current.setup).toEqual({ phase: 'downloading', receivedBytes: 300_000_000, totalBytes: 1_036_613_791 });
    expect(result.current.switching).toBe('local');

    push({ ...LOCAL });
    expect(result.current.switching).toBeNull();
    expect(result.current.mode).toBe('local');
  });

  it('cancels the download', async () => {
    const { invoke } = installApi(CLOUD);
    const { result } = await rendered();

    await act(async () => result.current.cancel());

    expect(invoke).toHaveBeenCalledWith('voice.cancelLocalTranscription');
  });

  it('shows why Local could not start and the state the host fell back to', async () => {
    const reason = 'Whisper turbo could not be downloaded, so Moxxy stays on Cloud: offline';
    let host: TranscriptionSettings = { ...CLOUD, modelReady: true };
    installApi(host, async () => {
      host = { ...CLOUD, modelReady: true, error: reason };
      throw new Error(reason);
    });
    const { result } = await rendered();

    await act(async () => result.current.choose('local'));

    expect(result.current.error).toBe(reason);
    expect(result.current.mode).toBe('cloud');
    expect(result.current.switching).toBeNull();
  });

  it('switches back to Cloud', async () => {
    const { invoke } = installApi(LOCAL);
    const { result } = await rendered();

    await act(async () => result.current.choose('cloud'));

    expect(invoke).toHaveBeenCalledWith('voice.useCloudTranscription');
    expect(result.current.mode).toBe('cloud');
  });

  it('does nothing when the chosen mode is already selected', async () => {
    const { invoke } = installApi(LOCAL);
    const { result } = await rendered();

    await act(async () => result.current.choose('local'));

    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');
  });
});
