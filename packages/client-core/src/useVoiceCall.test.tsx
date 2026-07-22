import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { configurePlatform, type AudioCaptureStartOptions, type SpeakOptions } from './platform.js';
import { __setApiOverride } from './transport.js';
import { useVoiceCall, type VoiceCallChat } from './useVoiceCall.js';

type PushHandler = (payload: never) => void;

function createTransport() {
  const subscribers = new Map<string, Set<PushHandler>>();
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'session.hasTranscriber') return true;
    if (channel === 'session.info') return { activeSynthesizer: 'local-piper' };
    if (channel === 'session.transcribe') return 'Opowiedz mi o kawie';
    if (channel === 'session.synthesize') {
      return { audioBase64: 'AQIDBA==', mimeType: 'audio/wav' };
    }
    throw new Error(`unexpected ${channel}`);
  });
  const api = {
    invoke: invoke as unknown as MoxxyApi['invoke'],
    subscribe: ((channel: string, handler: PushHandler) => {
      let listeners = subscribers.get(channel);
      if (!listeners) {
        listeners = new Set();
        subscribers.set(channel, listeners);
      }
      listeners.add(handler);
      return () => listeners?.delete(handler);
    }) as MoxxyApi['subscribe'],
  };
  return {
    api,
    invoke,
    emit(channel: string, payload: unknown): void {
      for (const handler of subscribers.get(channel) ?? []) handler(payload as never);
    },
  };
}

function createAudioPlatform() {
  const captures: AudioCaptureStartOptions[] = [];
  const cancels: Array<ReturnType<typeof vi.fn>> = [];
  const playback: SpeakOptions[] = [];
  const systemSpeak = vi.fn();
  configurePlatform({
    audioCapture: {
      isSupported: () => true,
      start: async (options) => {
        captures.push(options);
        const cancel = vi.fn();
        cancels.push(cancel);
        return { stop: vi.fn(), cancel };
      },
    },
    tts: {
      isSupported: () => true,
      speak: systemSpeak,
      cancel: vi.fn(),
      playClip: vi.fn((_base64, _mimeType, options = {}) => {
        playback.push(options);
        options.onAnalyser?.({ kind: 'piper-output' });
        return { stop: vi.fn() };
      }),
    },
  });
  return { captures, cancels, playback, systemSpeak };
}

function chat(overrides: Partial<VoiceCallChat> = {}): VoiceCallChat {
  return {
    sending: false,
    activeTurnId: null,
    error: null,
    send: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  configurePlatform({});
  __setApiOverride(null);
});

describe('useVoiceCall integration', () => {
  it('runs microphone, existing transcription, same-chat turn and Piper back to listening', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: 'workspace-coffee',
        ready: true,
        chat: currentChat,
        inputRequired: false,
      }),
      { initialProps: { currentChat: chatState } },
    );

    act(() => result.current.open());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    await waitFor(() => expect(audio.captures).toHaveLength(1));

    const inputAnalyser = { kind: 'microphone-input' };
    act(() => audio.captures[0]?.onAnalyser?.(inputAnalyser));
    expect(result.current.inputAnalyser).toBe(inputAnalyser);

    act(() => {
      audio.captures[0]?.onResult({
        pcm16Base64: 'AQIDBA==',
        mimeType: 'audio/x-moxxy-pcm16-24khz',
        peak: 0.4,
        sampleCount: 2,
      });
    });
    await waitFor(() => expect(send).toHaveBeenCalledWith('Opowiedz mi o kawie'));
    expect(result.current.lastTranscript).toBe('Opowiedz mi o kawie');

    chatState = chat({ send, sending: true, activeTurnId: 'turn-coffee' });
    rerender({ currentChat: chatState });
    act(() => {
      transport.emit('runner.turn.started', {
        workspaceId: 'workspace-coffee',
        turnId: 'turn-coffee',
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-coffee',
        event: {
          type: 'assistant_chunk',
          turnId: 'turn-coffee',
          delta: 'Kawa najlepiej smakuje świeżo zmielona.',
        },
      });
      transport.emit('runner.turn.complete', {
        workspaceId: 'workspace-coffee',
        turnId: 'turn-coffee',
        error: null,
      });
    });
    await waitFor(() => expect(result.current.phase).toBe('speaking'));
    expect(result.current.outputAnalyser).toEqual({ kind: 'piper-output' });
    expect(audio.systemSpeak).not.toHaveBeenCalled();

    act(() => audio.playback[0]?.onend?.());
    expect(audio.playback).toHaveLength(1);
    chatState = chat({ send });
    rerender({ currentChat: chatState });

    await waitFor(() => expect(result.current.phase).toBe('listening'));
    await waitFor(() => expect(audio.captures).toHaveLength(2));
  });

  it('refuses to start when Local Piper is not the active synthesizer', async () => {
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer: 'elevenlabs' };
      throw new Error(`unexpected ${channel}`);
    });
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-a',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorReason).toMatch(/Local Piper/i);
    expect(audio.captures).toHaveLength(0);
    expect(audio.systemSpeak).not.toHaveBeenCalled();
  });

  it('cancels the microphone without transcribing when the call closes', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-a',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => result.current.close());

    expect(audio.cancels[0]).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
    expect(transport.invoke).not.toHaveBeenCalledWith('session.transcribe', expect.anything());
  });

  it('does not reopen the microphone before the runner reports the turn complete', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: 'workspace-a',
        ready: true,
        chat: currentChat,
        inputRequired: false,
      }),
      { initialProps: { currentChat: chatState } },
    );

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());

    chatState = chat({ send, sending: true, activeTurnId: 'turn-a' });
    rerender({ currentChat: chatState });
    act(() => transport.emit('runner.turn.started', {
      workspaceId: 'workspace-a',
      turnId: 'turn-a',
    }));
    chatState = chat({ send });
    rerender({ currentChat: chatState });

    await act(async () => Promise.resolve());
    expect(result.current.phase).toBe('thinking');
    expect(audio.captures).toHaveLength(1);

    act(() => transport.emit('runner.turn.complete', {
      workspaceId: 'workspace-a',
      turnId: 'turn-a',
      error: null,
    }));
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    await waitFor(() => expect(audio.captures).toHaveLength(2));
  });

  it('releases the microphone and surfaces a reconnect error when the session drops', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const currentChat = chat();
    const { result, rerender } = renderHook(
      ({ ready }) => useVoiceCall({
        workspaceId: 'workspace-a',
        ready,
        chat: currentChat,
        inputRequired: false,
      }),
      { initialProps: { ready: true } },
    );

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    rerender({ ready: false });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorReason).toMatch(/connection/i);
    expect(audio.cancels[0]).toHaveBeenCalledOnce();
  });

  it('keeps a runner failure visible instead of silently returning to listening', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: 'workspace-a',
        ready: true,
        chat: currentChat,
        inputRequired: false,
      }),
      { initialProps: { currentChat: chatState } },
    );

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    chatState = chat({ send, sending: true, activeTurnId: 'turn-failed' });
    rerender({ currentChat: chatState });
    act(() => transport.emit('runner.turn.started', {
      workspaceId: 'workspace-a',
      turnId: 'turn-failed',
    }));
    chatState = chat({ send });
    rerender({ currentChat: chatState });
    act(() => transport.emit('runner.turn.complete', {
      workspaceId: 'workspace-a',
      turnId: 'turn-failed',
      error: 'Provider connection failed',
    }));

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.errorReason).toBe('Provider connection failed');
    expect(audio.captures).toHaveLength(1);
  });
});
