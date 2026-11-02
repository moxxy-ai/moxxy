import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { TranscriptionSettings } from '@moxxy/desktop-ipc-contract';
import { useTranscriptionSettings } from './useTranscriptionSettings';

afterEach(() => __setApiOverride(null));

const PARAKEET_BYTES = 670_478_372;
const WHISPER_BYTES = 1_036_613_791;
const CLOUD: TranscriptionSettings = {
  choice: 'cloud',
  active: 'openai-gpt-transcribe',
  models: [
    { id: 'parakeet', ready: false, bytes: PARAKEET_BYTES },
    { id: 'turbo', ready: true, bytes: WHISPER_BYTES },
  ],
  setup: null,
  error: null,
};
const PARAKEET: TranscriptionSettings = {
  ...CLOUD,
  choice: 'parakeet',
  active: 'local-parakeet',
  models: [
    { id: 'parakeet', ready: true, bytes: PARAKEET_BYTES },
    { id: 'turbo', ready: true, bytes: WHISPER_BYTES },
  ],
};

/**
 * Desktop IPC to the main process is the one boundary stood in here: `current`
 * is what the host reports, `push` sends a `voice.transcription.changed`.
 */
function installApi(
  initial: TranscriptionSettings,
  onCommand: (command: string) => Promise<TranscriptionSettings> = async (command) => (
    command === 'voice.useLocalTranscription' ? PARAKEET : CLOUD
  ),
) {
  let current = initial;
  let changed: (settings: TranscriptionSettings) => void = () => undefined;
  const invoke = vi.fn(async (command: string, _args?: unknown) => {
    if (command === 'voice.getTranscription') return current;
    if (command.startsWith('voice.') && command !== 'voice.cancelLocalTranscription') {
      current = await onCommand(command);
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
  it('reads the choice, what the runner runs and which models are here', async () => {
    installApi(PARAKEET);
    const { result } = await rendered();

    expect(result.current.choice).toBe('parakeet');
    expect(result.current.active).toBe('local-parakeet');
    expect(result.current.models.map((model) => model.ready)).toEqual([true, true]);
    expect(result.current.switching).toBeNull();
  });

  it('downloads and switches to a model in one step', async () => {
    const { invoke } = installApi(CLOUD);
    const { result } = await rendered();

    await act(async () => result.current.choose('parakeet'));

    expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription', { model: 'parakeet' });
    expect(result.current.choice).toBe('parakeet');
  });

  it('follows the download the host reports, wherever it was started', async () => {
    const { push } = installApi(CLOUD);
    const { result } = await rendered();

    push({ ...CLOUD, setup: { model: 'parakeet', phase: 'downloading', receivedBytes: 100, totalBytes: 1_000 } });

    expect(result.current.switching).toBe('parakeet');
    expect(result.current.setup).toMatchObject({ phase: 'downloading', receivedBytes: 100 });
  });

  it('cancels the download', async () => {
    const { invoke } = installApi(CLOUD);
    const { result } = await rendered();

    await act(async () => result.current.cancel());

    expect(invoke).toHaveBeenCalledWith('voice.cancelLocalTranscription');
  });

  it('shows why a model could not start, the state the host stayed on and which model failed', async () => {
    const { invoke } = installApi(CLOUD, async () => {
      throw new Error('Parakeet could not start, so Moxxy stays on OpenAI: no runner.');
    });
    const { result } = await rendered();

    await act(async () => result.current.choose('parakeet'));

    expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription', { model: 'parakeet' });
    expect(result.current.error).toMatch(/could not start/u);
    expect(result.current.failed).toBe('parakeet');
    expect(result.current.choice).toBe('cloud');
    expect(result.current.switching).toBeNull();
  });

  it('switches back to Cloud', async () => {
    const { invoke } = installApi(PARAKEET);
    const { result } = await rendered();

    await act(async () => result.current.choose('cloud'));

    expect(invoke).toHaveBeenCalledWith('voice.useCloudTranscription');
    expect(result.current.choice).toBe('cloud');
  });

  it('does nothing when the chosen one is already selected', async () => {
    const { invoke } = installApi(PARAKEET);
    const { result } = await rendered();

    await act(async () => result.current.choose('parakeet'));

    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription', { model: 'parakeet' });
  });

  it('removes a model and shows why it could not', async () => {
    const { invoke } = installApi(CLOUD, async (command) => {
      if (command === 'voice.removeLocalTranscriptionModel') throw new Error('Whisper turbo is in use.');
      return CLOUD;
    });
    const { result } = await rendered();

    await act(async () => result.current.remove('turbo'));

    expect(invoke).toHaveBeenCalledWith('voice.removeLocalTranscriptionModel', { model: 'turbo' });
    expect(result.current.error).toBe('Whisper turbo is in use.');
  });
});
