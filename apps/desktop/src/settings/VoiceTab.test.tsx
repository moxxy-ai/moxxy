import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { TranscriptionSettings, VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import { __resetVoiceEngineForTests } from '@/voice-call/useVoiceEngine';
import { VoiceTab } from './VoiceTab';

afterEach(() => {
  __setApiOverride(null);
  __resetVoiceEngineForTests();
});

const CLOUD: TranscriptionSettings = {
  choice: 'cloud',
  active: null,
  models: [
    { id: 'parakeet', ready: false, bytes: 670_478_372 },
    { id: 'turbo', ready: false, bytes: 1_036_613_791 },
  ],
  setup: null,
  error: null,
};
const WHISPER_HERE: TranscriptionSettings = {
  ...CLOUD,
  models: [
    { id: 'parakeet', ready: false, bytes: 670_478_372 },
    { id: 'turbo', ready: true, bytes: 1_036_613_791 },
  ],
};

/** Sends a `voice.transcription.changed` from the host; set by `installApi`. */
let pushTranscription: (settings: TranscriptionSettings) => void = () => undefined;

// Desktop IPC to the main process is the one boundary stood in here.
function installApi(
  engine: VoiceEnginePreference = 'local',
  useLocalTranscription: () => Promise<void> = async () => undefined,
  vaultEntries: Array<{ name: string }> = [],
  initial: TranscriptionSettings = CLOUD,
  backend = 'local-supertonic',
) {
  let transcription: TranscriptionSettings = initial;
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
    if (command === 'voice.getSettings') return { backend, voiceId: 'Fola' };
    if (command === 'settings.vaultEntries') return vaultEntries;
    if (command === 'voice.isLocalVoiceInstalled') return true;
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

function row(name: string): HTMLElement {
  return screen.getByTestId(`voice-model-${name}`);
}

/** Models come from the host, so their rows appear once it has answered. */
async function modelsLoaded(): Promise<void> {
  await screen.findByTestId('voice-model-parakeet');
}

describe('VoiceTab', () => {
  it('asks for the OpenAI API key once, in the OpenAI row', async () => {
    const invoke = installApi();
    render(<VoiceTab />);

    const field = await within(row('cloud')).findByLabelText(/^OpenAI API key/u);
    expect(within(row('cloud')).getByText(/GPT-Live uses this key too/u)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save OpenAI key' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', {
      name: 'OPENAI_API_KEY', value: 'sk-test',
    }));
    await screen.findByText(/key saved in this device vault/u);
  });

  it('shows everything on one page, each model with its description', async () => {
    installApi();
    render(<VoiceTab />);

    await modelsLoaded();
    expect(screen.queryByTestId('voice-section-conversation')).toBeNull();
    expect(screen.getByTestId('voice-engine-gpt-live')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dictation model' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Reading replies aloud' })).toBeTruthy();
    expect(row('parakeet').textContent).toContain('Fast. Detects the spoken language itself, in 25 languages. Download size: 670 MB.');
    expect(row('turbo').textContent).toContain('Slower. Works in about 100 languages. Download size: 1.0 GB.');
    expect(row('cloud').textContent).toContain('Runs in the cloud on your OpenAI API key.');
    expect(row('supertonic').textContent).toContain('Reads replies aloud on this computer, in Polish and English.');
    expect(row('gemini').textContent).toContain('Gemini Flash-Lite');
  });

  it('never mentions Piper', async () => {
    installApi();
    const { container } = render(<VoiceTab />);
    await screen.findByText(/Download size: 670 MB/u);

    expect(container.textContent).not.toMatch(/piper/iu);
  });

  it('describes GPT-Live and the Classic engine without any ChatGPT login', async () => {
    installApi('gpt-live');
    render(<VoiceTab />);

    expect(screen.getByTestId('voice-engine-local').textContent).toBe('Classic');
    expect(await screen.findByText(/GPT-Live.*your OpenAI API key/u)).toBeTruthy();
    expect(screen.queryByText(/ChatGPT login/u)).toBeNull();
  });

  it('says when OpenAI is chosen but its key is missing', async () => {
    installApi();
    render(<VoiceTab />);

    expect(await screen.findByText(/Add your OpenAI API key to use OpenAI transcription/u)).toBeTruthy();
    expect(within(row('cloud')).getByText('In use')).toBeTruthy();
  });

  it('saves a Gemini key, loads account voices and activates the chosen voice', async () => {
    const invoke = installApi();
    render(<VoiceTab />);

    await within(row('supertonic')).findByText('In use');
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

  it('switches the Voice Mode engine, and reading aloud says GPT-Live speaks for itself', async () => {
    const invoke = installApi('local');
    render(<VoiceTab />);

    fireEvent.click(screen.getByTestId('voice-engine-gpt-live'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.update', { voiceEngine: 'gpt-live' }));

    expect(screen.queryByTestId('voice-model-gemini')).toBeNull();
    expect(screen.queryByTestId('voice-model-supertonic')).toBeNull();
    expect(screen.getByText(/GPT-Live speaks with its own voice/u)).toBeTruthy();
  });

  it('shows no usage or cost estimate', async () => {
    const invoke = installApi();
    render(<VoiceTab />);
    await within(row('supertonic')).findByText('In use');

    expect(screen.queryByText(/Estimated Gemini usage/u)).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('voice.getUsage');
  });

  it('downloads a model from its row, shows how far along it is and can stop', async () => {
    let finish = (): void => undefined;
    const invoke = installApi('local', () => new Promise<void>((resolve) => { finish = resolve; }));
    render(<VoiceTab />);

    await modelsLoaded();
    fireEvent.click(within(row('parakeet')).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription', { model: 'parakeet' }));

    pushTranscription({
      ...CLOUD,
      setup: { model: 'parakeet', phase: 'downloading', receivedBytes: 300_000_000, totalBytes: 670_478_372 },
    });
    const bar = within(row('parakeet')).getByRole('progressbar', { name: 'Downloading Parakeet' });
    expect(bar.getAttribute('aria-valuenow')).toBe('44');
    expect(within(row('parakeet')).getByText('300 of 670 MB')).toBeTruthy();
    // The other models wait for this one.
    expect((within(row('turbo')).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.cancelLocalTranscription'));

    pushTranscription({ ...CLOUD, setup: { model: 'parakeet', phase: 'starting' } });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(within(row('parakeet')).getByText(/Starting Parakeet/u)).toBeTruthy();

    pushTranscription({
      ...CLOUD,
      choice: 'parakeet',
      active: 'local-parakeet',
      models: [
        { id: 'parakeet', ready: true, bytes: 670_478_372 },
        { id: 'turbo', ready: false, bytes: 1_036_613_791 },
      ],
    });
    finish();
    await within(row('parakeet')).findByText('In use');
  });

  it('offers Use and Remove for a downloaded model, and Remove only when it is not in use', async () => {
    const invoke = installApi('local', async () => undefined, [], WHISPER_HERE);
    render(<VoiceTab />);

    await modelsLoaded();
    fireEvent.click(within(row('turbo')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.removeLocalTranscriptionModel', { model: 'turbo' }));
    fireEvent.click(within(row('turbo')).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.useLocalTranscription', { model: 'turbo' }));

    pushTranscription({ ...WHISPER_HERE, choice: 'turbo', active: 'local-whisper' });
    expect(within(row('turbo')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(row('turbo')).getByText('In use')).toBeTruthy();
  });

  it('offers Try again on the model that failed', async () => {
    installApi('local', async () => { throw new Error('Parakeet could not be downloaded, so Moxxy stays on OpenAI: HTTP 503'); });
    render(<VoiceTab />);

    await modelsLoaded();
    fireEvent.click(within(row('parakeet')).getByRole('button', { name: 'Download' }));

    expect(await within(row('parakeet')).findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/HTTP 503/u);
    expect(within(row('turbo')).getByRole('button', { name: 'Download' })).toBeTruthy();
  });

  it('says when a chosen local model is not running', async () => {
    installApi('local', async () => undefined, [], { ...WHISPER_HERE, choice: 'turbo', active: null });
    render(<VoiceTab />);

    await modelsLoaded();
    expect(within(row('turbo')).getByText(/not running yet/iu)).toBeTruthy();
  });

  it('switches back to the local voice from its row', async () => {
    const invoke = installApi('local', async () => undefined, [], CLOUD, 'gemini-tts');
    render(<VoiceTab />);

    await within(row('gemini')).findByText('In use');
    fireEvent.click(within(row('supertonic')).getByRole('button', { name: 'Use' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.useLocalVoice'));
    await within(row('supertonic')).findByText('In use');
  });
});
