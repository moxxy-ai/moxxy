import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { TranscriptionSettings, VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import { __resetVoiceEngineForTests } from '@/voice-call/useVoiceEngine';
import { VoiceTab } from './VoiceTab';

afterEach(() => {
  __setApiOverride(null);
  __resetVoiceEngineForTests();
});

const MODEL_BYTES = 1_036_613_791;
const CLOUD: TranscriptionSettings = {
  mode: 'cloud',
  active: 'openai-codex-transcribe',
  modelReady: false,
  modelBytes: MODEL_BYTES,
  setup: null,
  error: null,
};

/** Sends a `voice.transcription.changed` from the host; set by `installApi`. */
let pushTranscription: (settings: TranscriptionSettings) => void = () => undefined;

// Desktop IPC to the main process is the one boundary stood in here.
function installApi(
  engine: VoiceEnginePreference = 'local',
  useLocalTranscription: () => Promise<void> = async () => undefined,
) {
  let transcription: TranscriptionSettings = CLOUD;
  let changed: (settings: TranscriptionSettings) => void = () => undefined;
  pushTranscription = (settings) => {
    transcription = settings;
    act(() => changed(settings));
  };
  const invoke = vi.fn(async (command: string, _args?: unknown) => {
    if (command === 'voice.getTranscription') return transcription;
    if (command === 'voice.useLocalTranscription') {
      await useLocalTranscription();
      return undefined;
    }
    if (command === 'prefs.read') return { voiceEngine: engine };
    if (command === 'prefs.update') return {};
    if (command === 'voice.getSettings') return { backend: 'local-piper', voiceId: 'Fola' };
    if (command === 'settings.vaultEntries') return [];
    if (command === 'voice.isLocalPiperInstalled') return true;
    if (command === 'voice.listGeminiVoices') {
      return [{ id: 'Fola', displayName: 'Fola', languageCode: 'en-US' }];
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
  return invoke;
}

describe('VoiceTab', () => {
  it('saves a Gemini key, loads account voices and activates the chosen voice', async () => {
    const invoke = installApi();
    render(<VoiceTab />);

    expect(screen.getByText(/played one sentence at a time, with up to two upcoming sentences prepared ahead/i))
      .toBeTruthy();
    await screen.findByText('Current voice: Local · Piper');
    fireEvent.change(screen.getByLabelText(/Gemini API key/u), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', {
      name: 'GEMINI_API_KEY', value: 'test-key',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Load voices' }));
    await screen.findByRole('option', { name: 'Fola · en-US (Fola)' });
    fireEvent.click(screen.getByRole('button', { name: 'Use Gemini voice' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.useGeminiTts', { voiceId: 'Fola' }));
  });

  it('holds the Voice Mode engine choice next to the spoken voices', async () => {
    const invoke = installApi('local');
    render(<VoiceTab />);

    expect(screen.getByTestId('voice-engine-local')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gemini Flash-Lite' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Local Piper' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('voice-engine-gpt-live'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.update', { voiceEngine: 'gpt-live' }));
    expect(screen.queryByRole('heading', { name: 'Gemini Flash-Lite' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Local Piper' })).toBeNull();
    expect(screen.getByText(/GPT-Live speaks with its own voice/u)).toBeTruthy();
  });

  it('shows no usage or cost estimate', async () => {
    const invoke = installApi();
    render(<VoiceTab />);
    await screen.findByText('Current voice: Local · Piper');

    expect(screen.queryByText(/Estimated Gemini usage/u)).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('voice.getUsage');
  });

  it('asks before the first switch to Local downloads the model, then shows the download with a way to stop it', async () => {
    let finish = (): void => undefined;
    const invoke = installApi('local', () => new Promise<void>((resolve) => { finish = resolve; }));
    render(<VoiceTab />);

    const cloud = await screen.findByTestId('transcription-cloud');
    await waitFor(() => expect(cloud.getAttribute('data-active')).toBe('true'));
    expect(screen.getByText(/transcribed by OpenAI over your ChatGPT login/u)).toBeTruthy();

    fireEvent.click(screen.getByTestId('transcription-local'));
    const dialog = await screen.findByRole('dialog', { name: 'Download Whisper turbo?' });
    expect(dialog.textContent).toMatch(/downloads it once \(about 1\.0 GB\)/u);
    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription'));
    expect(screen.queryByRole('dialog')).toBeNull();

    pushTranscription({ ...CLOUD, setup: { phase: 'downloading', receivedBytes: 300_000_000, totalBytes: MODEL_BYTES } });
    const bar = screen.getByRole('progressbar', { name: 'Downloading Whisper turbo' });
    expect(bar.getAttribute('aria-valuenow')).toBe('28');
    expect(screen.getByText('300 of 1037 MB')).toBeTruthy();
    // The pill shows where it is going while the switch runs.
    expect(screen.getByTestId('transcription-local').getAttribute('data-active')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.cancelLocalTranscription'));

    pushTranscription({ ...CLOUD, modelReady: true, setup: { phase: 'starting' } });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/Starting local transcription/u)).toBeTruthy();

    pushTranscription({ ...CLOUD, mode: 'local', active: 'local-whisper', modelReady: true });
    finish();
    await screen.findByText(/Whisper turbo runs on this computer/u);
    await waitFor(() => expect(screen.getByTestId('transcription-local').getAttribute('data-active')).toBe('true'));
  });

  it('downloads nothing when the person says not now', async () => {
    const invoke = installApi();
    render(<VoiceTab />);
    const cloud = await screen.findByTestId('transcription-cloud');
    await waitFor(() => expect(cloud.getAttribute('data-active')).toBe('true'));

    fireEvent.click(screen.getByTestId('transcription-local'));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');
    expect(screen.getByTestId('transcription-cloud').getAttribute('data-active')).toBe('true');
  });
});
