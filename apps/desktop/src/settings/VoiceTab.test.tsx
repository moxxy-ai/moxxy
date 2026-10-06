import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import { __resetVoiceEngineForTests } from '@/voice-call/useVoiceEngine';
import { VoiceTab } from './VoiceTab';

afterEach(() => {
  __setApiOverride(null);
  __resetVoiceEngineForTests();
});

// Desktop IPC to the main process is the one boundary stood in here.
function installApi(engine: VoiceEnginePreference = 'local') {
  const invoke = vi.fn(async (command: string, _args?: unknown) => {
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
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
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
});
