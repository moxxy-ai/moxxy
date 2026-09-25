import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { useVoiceSettings } from './useVoiceSettings';

describe('useVoiceSettings', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let eventHandlers: Map<string, (payload: unknown) => void>;

  beforeEach(() => {
    eventHandlers = new Map();
    invoke = vi.fn(async (command: string) => {
      if (command === 'voice.getSettings') return { backend: 'local-piper', voiceId: 'Fola' };
      if (command === 'settings.vaultEntries') return [];
      if (command === 'voice.isLocalPiperInstalled') return true;
      if (command === 'voice.getUsage') return {
        requestCount: 2,
        estimatedRequestCount: 0,
        inputTextTokens: 200,
        outputAudioTokens: 750,
        estimatedCostUsd: 0.0046,
        updatedAt: '2026-09-25T12:00:00.000Z',
      };
      if (command === 'voice.listGeminiVoices') {
        return [{ id: 'Fola', displayName: 'Fola', languageCode: 'en-US' }];
      }
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: (channel: string, handler: (payload: unknown) => void) => {
        eventHandlers.set(channel, handler);
        return () => { eventHandlers.delete(channel); };
      },
    } as never);
  });

  afterEach(() => __setApiOverride(null));

  it('loads the current backend, stores the key in the vault and lists account voices', async () => {
    const { result } = renderHook(() => useVoiceSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.backend).toBe('local-piper');
    expect(result.current.hasGeminiKey).toBe(false);
    await waitFor(() => expect(result.current.usage?.estimatedCostUsd).toBe(0.0046));

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

  it('updates usage when a Gemini synthesis completes without refreshing the tab', async () => {
    const { result } = renderHook(() => useVoiceSettings());
    await waitFor(() => expect(result.current.loadingUsage).toBe(false));
    const completedUsage = {
      requestCount: 3,
      estimatedRequestCount: 1,
      inputTextTokens: 240,
      outputAudioTokens: 900,
      estimatedCostUsd: 0.00552,
      updatedAt: '2026-09-25T12:01:00.000Z',
    };

    act(() => eventHandlers.get('voice.usage.changed')?.(completedUsage));

    expect(result.current.usage).toEqual(completedUsage);
  });
});
