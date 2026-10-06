import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import { VoiceEngineSection } from '../settings/VoiceEngineSection';
import {
  __resetVoiceEngineForTests,
  setVoiceEnginePreference,
  useVoiceEnginePreference,
} from './useVoiceEngine';

// Desktop IPC to the main process (which owns prefs.json) is the one boundary
// stood in here; the preference store and the settings control run for real.
function installPrefsApi(stored: VoiceEnginePreference | undefined) {
  const updates: unknown[] = [];
  __setApiOverride({
    invoke: (async (channel: string, args?: unknown) => {
      if (channel === 'prefs.read') return { voiceEngine: stored };
      if (channel === 'prefs.update') {
        updates.push(args);
        return {};
      }
      throw new Error(`unexpected ${channel}`);
    }) as MoxxyApi['invoke'],
    subscribe: (() => () => undefined) as MoxxyApi['subscribe'],
  });
  return updates;
}

afterEach(() => {
  __setApiOverride(null);
  __resetVoiceEngineForTests();
});

describe('voice engine preference', () => {
  it('loads the persisted engine and falls back to local', async () => {
    installPrefsApi('gpt-live');
    const { result } = renderHook(() => useVoiceEnginePreference());
    expect(result.current).toBe('local');
    await waitFor(() => expect(result.current).toBe('gpt-live'));

    __resetVoiceEngineForTests();
    installPrefsApi(undefined);
    const fresh = renderHook(() => useVoiceEnginePreference());
    await waitFor(() => expect(fresh.result.current).toBe('local'));
  });

  it('switches every reader at once and persists the choice', async () => {
    const updates = installPrefsApi('local');
    const first = renderHook(() => useVoiceEnginePreference());
    const second = renderHook(() => useVoiceEnginePreference());

    act(() => setVoiceEnginePreference('gpt-live'));

    expect(first.result.current).toBe('gpt-live');
    expect(second.result.current).toBe('gpt-live');
    await waitFor(() => expect(updates).toEqual([{ voiceEngine: 'gpt-live' }]));
  });

  it('lets the user pick GPT-Live in Settings', async () => {
    const updates = installPrefsApi('local');
    render(<VoiceEngineSection />);

    act(() => screen.getByTestId('voice-engine-gpt-live').click());

    await waitFor(() => expect(updates).toEqual([{ voiceEngine: 'gpt-live' }]));
    expect(screen.getByText(/ChatGPT login/i)).toBeTruthy();
  });
});
