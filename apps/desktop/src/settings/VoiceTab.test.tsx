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
  active: null,
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
  vaultEntries: Array<{ name: string }> = [],
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
    if (command === 'settings.vaultEntries') return vaultEntries;
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

function openSection(name: 'conversation' | 'read-aloud' | 'transcription'): void {
  fireEvent.click(screen.getByTestId(`voice-section-${name}`));
}

describe('VoiceTab', () => {
  it('asks for the OpenAI API key once, for every OpenAI voice feature', async () => {
    const invoke = installApi();
    render(<VoiceTab />);

    const field = await screen.findByLabelText(/^OpenAI API key/u);
    expect(screen.getByText(/GPT-Live and OpenAI transcription both use this key/u)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save OpenAI key' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', {
      name: 'OPENAI_API_KEY', value: 'sk-test',
    }));
    await screen.findByText(/key saved in this device vault/u);
  });

  it('splits voice into Conversation, Read aloud and Transcription tabs', async () => {
    installApi();
    render(<VoiceTab />);

    expect(screen.getByTestId('voice-section-conversation').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('voice-engine-gpt-live')).toBeTruthy();
    expect(screen.queryByTestId('transcription-cloud')).toBeNull();

    openSection('read-aloud');
    expect(screen.getByRole('heading', { name: 'Local Piper' })).toBeTruthy();
    expect(screen.queryByTestId('voice-engine-gpt-live')).toBeNull();

    openSection('transcription');
    expect(await screen.findByTestId('transcription-cloud')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Local Piper' })).toBeNull();
  });

  it('describes GPT-Live and the Classic engine without any ChatGPT login', async () => {
    installApi('gpt-live');
    render(<VoiceTab />);

    expect(screen.getByTestId('voice-engine-local').textContent).toBe('Classic');
    expect(await screen.findByText(/GPT-Live.*your OpenAI API key/u)).toBeTruthy();
    expect(screen.queryByText(/ChatGPT login/u)).toBeNull();
  });

  it('offers OpenAI transcription on the API key, and says when the key is missing', async () => {
    installApi();
    render(<VoiceTab />);
    openSection('transcription');

    const openai = await screen.findByTestId('transcription-cloud');
    expect(openai.textContent).toBe('OpenAI');
    expect(screen.getByText(/transcribed by OpenAI with your OpenAI API key/u)).toBeTruthy();
    expect(await screen.findByText(/Add your OpenAI API key above to use OpenAI transcription/u)).toBeTruthy();
    expect(screen.queryByText(/ChatGPT login/u)).toBeNull();
  });

  it('saves a Gemini key, loads account voices and activates the chosen voice', async () => {
    const invoke = installApi();
    render(<VoiceTab />);
    openSection('read-aloud');

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

  it('switches the Voice Mode engine, and Read aloud says GPT-Live speaks for itself', async () => {
    const invoke = installApi('local');
    render(<VoiceTab />);

    fireEvent.click(screen.getByTestId('voice-engine-gpt-live'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.update', { voiceEngine: 'gpt-live' }));

    openSection('read-aloud');
    expect(screen.queryByRole('heading', { name: 'Gemini Flash-Lite' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Local Piper' })).toBeNull();
    expect(screen.getByText(/GPT-Live speaks with its own voice/u)).toBeTruthy();
  });

  it('shows no usage or cost estimate', async () => {
    const invoke = installApi();
    render(<VoiceTab />);
    openSection('read-aloud');
    await screen.findByText('Current voice: Local · Piper');

    expect(screen.queryByText(/Estimated Gemini usage/u)).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('voice.getUsage');
  });

  it('asks before the first switch to Local downloads the model, then shows the download with a way to stop it', async () => {
    let finish = (): void => undefined;
    const invoke = installApi('local', () => new Promise<void>((resolve) => { finish = resolve; }));
    render(<VoiceTab />);
    openSection('transcription');

    const cloud = await screen.findByTestId('transcription-cloud');
    await waitFor(() => expect(cloud.getAttribute('data-active')).toBe('true'));

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
    openSection('transcription');
    const cloud = await screen.findByTestId('transcription-cloud');
    await waitFor(() => expect(cloud.getAttribute('data-active')).toBe('true'));

    fireEvent.click(screen.getByTestId('transcription-local'));
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('voice.useLocalTranscription');
    expect(screen.getByTestId('transcription-cloud').getAttribute('data-active')).toBe('true');
  });
});
