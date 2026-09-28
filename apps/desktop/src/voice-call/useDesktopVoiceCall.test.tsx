import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import type { GptLiveConnectOptions, GptLiveTransport } from './gpt-live/gpt-live-transport';
import { useDesktopVoiceCall } from './useDesktopVoiceCall';
import { __resetVoiceEngineForTests, setVoiceEnginePreference } from './useVoiceEngine';

// Stand-ins only at the main-process IPC boundary and the WebRTC transport.
function installApi(engine: VoiceEnginePreference) {
  const invoke = vi.fn(async (channel: string, _args?: unknown) => {
    switch (channel) {
      case 'prefs.read': return { voiceEngine: engine };
      case 'prefs.update': return {};
      case 'voice.live.preflight': return { authenticated: true };
      case 'voice.live.start': return { sdp: 'v=0\r\no=answer\r\n', callId: 'rtc_1' };
      case 'voice.setRealtimeCaptureActive': return undefined;
      case 'session.hasTranscriber': return false;
      case 'session.info': return { activeSynthesizer: null };
      default: throw new Error(`unexpected ${channel}`);
    }
  });
  __setApiOverride({
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: (() => () => undefined) as MoxxyApi['subscribe'],
  });
  return invoke;
}

class InMemoryGptLiveTransport implements GptLiveTransport {
  closed = false;
  async connect(options: GptLiveConnectOptions) {
    const answer = await options.negotiate('v=0\r\no=offer\r\n');
    return {
      callId: answer.callId,
      send: () => undefined,
      setMuted: () => undefined,
      close: () => { this.closed = true; },
    };
  }
}

const chat = { sending: false, activeTurnId: null, error: null, send: async () => undefined };

function render(transport: GptLiveTransport) {
  return renderHook(() => useDesktopVoiceCall({
    surface: 'main',
    workspaceId: 'workspace-1',
    ready: true,
    chat,
    inputRequired: false,
    gptLiveTransport: transport,
  }));
}

afterEach(() => {
  // Unmount while the IPC stand-in is still installed: closing a call talks to it.
  cleanup();
  __setApiOverride(null);
  __resetVoiceEngineForTests();
});

describe('useDesktopVoiceCall engine selection', () => {
  it('runs Voice Mode through GPT-Live when that engine is selected', async () => {
    const invoke = installApi('gpt-live');
    const transport = new InMemoryGptLiveTransport();
    const { result } = render(transport);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.read'));

    act(() => result.current.open());

    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(invoke).toHaveBeenCalledWith('voice.live.start', expect.objectContaining({ workspaceId: 'workspace-1' }));
    expect(invoke).not.toHaveBeenCalledWith('session.hasTranscriber');
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('voice.setRealtimeCaptureActive', { active: true }));
  });

  it('exposes the GPT-Live waiting task only for the GPT-Live engine', async () => {
    const invoke = installApi('local');
    const { result } = render(new InMemoryGptLiveTransport());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.read'));

    expect(result.current.pendingVoiceTask).toBeNull();
    expect(typeof result.current.cancelPendingVoiceTask).toBe('function');
  });

  it('keeps the local engine by default', async () => {
    const invoke = installApi('local');
    const { result } = render(new InMemoryGptLiveTransport());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('prefs.read'));

    act(() => result.current.open());

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('session.hasTranscriber'));
    expect(invoke).not.toHaveBeenCalledWith('voice.live.preflight');
  });

  it('ends a live call when the user switches engines mid-call', async () => {
    installApi('gpt-live');
    const transport = new InMemoryGptLiveTransport();
    const { result } = render(transport);
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    act(() => result.current.open());
    await waitFor(() => expect(result.current.phase).toBe('listening'));

    act(() => setVoiceEnginePreference('local'));

    await waitFor(() => expect(transport.closed).toBe(true));
    expect(result.current.active).toBe(false);
  });
});
