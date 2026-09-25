import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { VoiceTab } from './VoiceTab';

afterEach(() => __setApiOverride(null));

describe('VoiceTab', () => {
  it('saves a Gemini key, loads account voices and activates the chosen voice', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'voice.getSettings') return { backend: 'local-piper', voiceId: 'Fola' };
      if (command === 'settings.vaultEntries') return [];
      if (command === 'voice.isLocalPiperInstalled') return true;
      if (command === 'voice.listGeminiVoices') {
        return [{ id: 'Fola', displayName: 'Fola', languageCode: 'en-US' }];
      }
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
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
});
