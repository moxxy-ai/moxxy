import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useVoiceSettings } from './useVoiceSettings';

describe('useVoiceSettings', () => {
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn(async (command: string) => {
      if (command === 'voice.getSettings') return { backend: 'local-piper', voiceId: 'Fola' };
      if (command === 'settings.vaultEntries') return [];
      if (command === 'voice.isLocalPiperInstalled') return true;
      if (command === 'voice.listGeminiVoices') {
        return [{ id: 'Fola', displayName: 'Fola', languageCode: 'en-US' }];
      }
      return undefined;
    });
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  });

  afterEach(() => __setApiOverride(null));

  it('loads the current backend, stores the key in the vault and lists account voices', async () => {
    const { result } = renderHook(() => useVoiceSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.backend).toBe('local-piper');
    expect(result.current.hasGeminiKey).toBe(false);

    act(() => result.current.setApiKeyDraft('secret-key'));
    await act(async () => result.current.saveGeminiApiKey());
    expect(invoke).toHaveBeenCalledWith('settings.vaultSet', {
      name: 'GEMINI_API_KEY', value: 'secret-key',
    });
    await act(async () => result.current.loadVoices());
    expect(result.current.voices.map((voice) => voice.id)).toEqual(['Fola']);
  });

  it('selects the saved cloud voice or returns to local Piper', async () => {
    const { result } = renderHook(() => useVoiceSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setApiKeyDraft('secret-key'));
    await act(async () => result.current.saveGeminiApiKey());
    await act(async () => result.current.loadVoices());
    await act(async () => result.current.useGeminiVoice());
    expect(invoke).toHaveBeenCalledWith('voice.useGeminiTts', { voiceId: 'Fola' });
    await act(async () => result.current.useLocalPiper());
    expect(invoke).toHaveBeenCalledWith('voice.useLocalPiper');
  });
});
