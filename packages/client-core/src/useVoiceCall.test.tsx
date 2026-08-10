import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { configurePlatform, type AudioCaptureStartOptions, type SpeakOptions } from './platform.js';
import { __setApiOverride } from './transport.js';
import { chatStore } from './chatStore.js';
import { ChatStoreBridge, useChat, useQueuedTurns } from './useChat.js';
import { useVoiceCall, type VoiceCallChat } from './useVoiceCall.js';

type PushHandler = (payload: never) => void;

const WAITING_TONE = {
  audioUrl: '/assets/voice-waiting-loop.ogg',
} as const;

function createTransport(transcript: string | Promise<string> = 'Opowiedz mi o kawie') {
  const subscribers = new Map<string, Set<PushHandler>>();
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'session.hasTranscriber') return true;
    if (channel === 'session.info') return { activeSynthesizer: 'local-piper' };
    if (channel === 'session.transcribe') return transcript;
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

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error('deferred promise is not initialized');
      resolvePromise(value);
    },
    reject(reason: unknown): void {
      if (!rejectPromise) throw new Error('deferred promise is not initialized');
      rejectPromise(reason);
    },
  };
}

function createAudioPlatform(startGate?: Promise<void>, resumeGate?: Promise<void>) {
  const captures: AudioCaptureStartOptions[] = [];
  const cancels: Array<ReturnType<typeof vi.fn>> = [];
  const suspends: Array<ReturnType<typeof vi.fn>> = [];
  const resumes: Array<ReturnType<typeof vi.fn>> = [];
  const captureStops: Array<ReturnType<typeof vi.fn>> = [];
  const utteranceMarks: Array<ReturnType<typeof vi.fn>> = [];
  const playback: SpeakOptions[] = [];
  const playbackStops: Array<ReturnType<typeof vi.fn>> = [];
  const waitingTonePlayback: Array<{
    readonly options: SpeakOptions;
    readonly stop: ReturnType<typeof vi.fn>;
  }> = [];
  const storage = new Map<string, string>();
  const systemSpeak = vi.fn();
  configurePlatform({
    audioCapture: {
      isSupported: () => true,
      start: async (options) => {
        captures.push(options);
        const cancel = vi.fn();
        const suspend = vi.fn();
        const resume = vi.fn(async () => {
          await resumeGate;
        });
        const stop = vi.fn();
        const markUtteranceStart = vi.fn();
        cancels.push(cancel);
        suspends.push(suspend);
        resumes.push(resume);
        captureStops.push(stop);
        utteranceMarks.push(markUtteranceStart);
        await startGate;
        return { stop, cancel, suspend, resume, markUtteranceStart };
      },
    },
    tts: {
      isSupported: () => true,
      speak: systemSpeak,
      cancel: vi.fn(),
      playClip: vi.fn((_base64, _mimeType, options = {}) => {
        playback.push(options);
        options.onAnalyser?.({ kind: 'piper-output' });
        const stop = vi.fn();
        playbackStops.push(stop);
        return { stop };
      }),
      playUrl: vi.fn((url, options = {}) => {
        if (url !== WAITING_TONE.audioUrl) throw new Error(`unexpected audio asset ${url}`);
        const stop = vi.fn();
        waitingTonePlayback.push({ options, stop });
        return { stop };
      }),
    },
    kv: {
      get length() {
        return storage.size;
      },
      key: (index) => [...storage.keys()][index] ?? null,
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  });
  return {
    captures,
    cancels,
    suspends,
    resumes,
    captureStops,
    utteranceMarks,
    waitingTonePlayback,
    playback,
    playbackStops,
    storage,
    systemSpeak,
  };
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

function ChatBridge({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <>
      <ChatStoreBridge />
      {children}
    </>
  );
}

afterEach(() => {
  configurePlatform({});
  __setApiOverride(null);
});

describe('useVoiceCall integration', () => {
  it('starts the waiting tone while transcription is still in flight without restarting it', async () => {
    const transcript = deferred<string>();
    const transport = createTransport(transcript.promise);
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-transcribing',
      ready: true,
      chat: chat({ send }),
      inputRequired: false,
      waitingTone: WAITING_TONE,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));

    await waitFor(() => expect(result.current.phase).toBe('transcribing'));
    await waitFor(() => expect(audio.waitingTonePlayback).toHaveLength(1), { timeout: 1_000 });
    expect(send).not.toHaveBeenCalled();

    act(() => transcript.resolve('Cześć'));
    await waitFor(() => expect(send).toHaveBeenCalledWith('Cześć'));
    expect(audio.waitingTonePlayback).toHaveLength(1);
    expect(audio.waitingTonePlayback[0]?.stop).not.toHaveBeenCalled();
  });

  it.each([
    {
      transcript: 'Sprawdź proszę dokumentację projektu.',
      language: 'pl',
      cue: 'Sprawdzam potrzebne informacje.',
    },
    {
      transcript: 'Please inspect the project documentation.',
      language: 'en',
      cue: 'I am checking the information now.',
    },
  ] as const)('keeps $language tool activity visual without speaking immediately', async ({
    transcript,
    language,
    cue,
  }) => {
    const transport = createTransport(transcript);
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: `workspace-${language}`,
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
    await waitFor(() => expect(send).toHaveBeenCalledWith(transcript));

    chatState = chat({ send, sending: true, activeTurnId: `turn-${language}` });
    rerender({ currentChat: chatState });
    act(() => {
      transport.emit('runner.turn.started', {
        workspaceId: `workspace-${language}`,
        turnId: `turn-${language}`,
      });
      transport.emit('runner.event', {
        workspaceId: `workspace-${language}`,
        event: {
          type: 'tool_call_requested',
          turnId: `turn-${language}`,
          callId: `call-${language}`,
          name: 'Read',
          input: { path: '/private/path-that-must-not-be-spoken' },
        },
      });
      transport.emit('runner.event', {
        workspaceId: `workspace-${language}`,
        event: {
          type: 'tool_call_approved',
          turnId: `turn-${language}`,
          callId: `call-${language}`,
        },
      });
    });

    await waitFor(() => expect(result.current.phase).toBe('working'));
    expect(result.current.activity).toBe('research');
    expect(result.current.activeOperations).toEqual([{
      callId: `call-${language}`,
      kind: 'project-read',
      ordinal: 0,
    }]);
    expect(JSON.stringify(result.current.activeOperations)).not.toContain('/private/path');
    expect(transport.invoke).not.toHaveBeenCalledWith('session.synthesize', expect.objectContaining({
      text: cue,
      language,
    }));
    expect(transport.invoke).not.toHaveBeenCalledWith('session.synthesize', expect.objectContaining({
      text: expect.stringContaining('/private/path'),
    }));

    act(() => {
      transport.emit('runner.event', {
        workspaceId: `workspace-${language}`,
        event: {
          type: 'tool_result',
          turnId: `turn-${language}`,
          callId: `call-${language}`,
          ok: true,
          output: 'done',
        },
      });
    });
    await waitFor(() => expect(result.current.activity).toBeNull());
    expect(result.current.activeOperations).toEqual([]);
  });

  it('loops the local waiting tone and persists the user sound preference', async () => {
    const transport = createTransport('Cześć');
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-greeting',
      ready: true,
      chat: chat({ send }),
      inputRequired: false,
      waitingTone: WAITING_TONE,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));

    await waitFor(() => expect(send).toHaveBeenCalledWith('Cześć'));
    await waitFor(() => expect(audio.waitingTonePlayback).toHaveLength(1), { timeout: 1_000 });
    expect(audio.waitingTonePlayback[0]?.options.loop).toBe(true);
    expect(result.current.waitingSoundEnabled).toBe(true);

    act(() => result.current.toggleWaitingSound());
    expect(result.current.waitingSoundEnabled).toBe(false);
    expect(audio.waitingTonePlayback[0]?.stop).toHaveBeenCalledOnce();
    expect([...audio.storage.values()]).toContain('0');

    act(() => result.current.toggleWaitingSound());
    expect(result.current.waitingSoundEnabled).toBe(true);
    await waitFor(() => expect(audio.waitingTonePlayback).toHaveLength(2), { timeout: 1_000 });
    expect([...audio.storage.values()]).toContain('1');
    expect(transport.invoke).not.toHaveBeenCalledWith(
      'session.synthesize',
      expect.objectContaining({ text: expect.any(String) }),
    );
  });

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
    await waitFor(() => expect(audio.captures).toHaveLength(3));
    expect(audio.cancels[1]).toHaveBeenCalledOnce();
  });

  it('interrupts only Piper, preserves the live turn, and queues the continued utterance', async () => {
    const transport = createTransport('Mam dodatkowe pytanie');
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat, inputRequired }) => useVoiceCall({
        workspaceId: 'workspace-barge-in',
        ready: true,
        chat: currentChat,
        inputRequired,
      }),
      { initialProps: { currentChat: chatState, inputRequired: false } },
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

    chatState = chat({
      send,
      sending: true,
      activeTurnId: 'turn-barge-in',
    });
    rerender({ currentChat: chatState, inputRequired: false });
    act(() => {
      transport.emit('runner.turn.started', {
        workspaceId: 'workspace-barge-in',
        turnId: 'turn-barge-in',
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-barge-in',
        event: {
          type: 'tool_call_requested',
          turnId: 'turn-barge-in',
          callId: 'call-barge-in',
          name: 'web_search',
          input: { query: 'private query' },
        },
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-barge-in',
        event: {
          type: 'tool_call_approved',
          turnId: 'turn-barge-in',
          callId: 'call-barge-in',
        },
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-barge-in',
        event: {
          type: 'assistant_chunk',
          turnId: 'turn-barge-in',
          delta: 'To jest odpowiedź, którą użytkownik przerwie.',
        },
      });
    });
    await waitFor(() => expect(result.current.phase).toBe('speaking'));
    await waitFor(() => expect(audio.captures).toHaveLength(2));
    const synthesizedBeforeInterrupt = transport.invoke.mock.calls.filter(
      ([channel]) => channel === 'session.synthesize',
    ).length;

    act(() => result.current.bargeIn());

    expect(result.current.phase).toBe('listening');
    expect(audio.utteranceMarks[1]).toHaveBeenCalledOnce();
    expect(audio.playbackStops[0]).toHaveBeenCalledOnce();
    expect(result.current.activeOperations).toEqual([{
      callId: 'call-barge-in',
      kind: 'web-search',
      ordinal: 0,
    }]);

    act(() => {
      transport.emit('runner.event', {
        workspaceId: 'workspace-barge-in',
        event: {
          type: 'tool_call_requested',
          turnId: 'turn-barge-in',
          callId: 'call-after-barge-in',
          name: 'Read',
          input: { path: '/private/file' },
        },
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-barge-in',
        event: {
          type: 'tool_call_approved',
          turnId: 'turn-barge-in',
          callId: 'call-after-barge-in',
        },
      });
    });
    expect(result.current.phase).toBe('listening');
    expect(result.current.activeOperations).toHaveLength(2);

    rerender({ currentChat: chatState, inputRequired: true });
    expect(result.current.phase).toBe('listening');
    expect(audio.cancels[1]).not.toHaveBeenCalled();
    rerender({ currentChat: chatState, inputRequired: false });

    act(() => transport.emit('runner.event', {
      workspaceId: 'workspace-barge-in',
      event: {
        type: 'assistant_chunk',
        turnId: 'turn-barge-in',
        delta: 'Tego późnego fragmentu nie wolno już powiedzieć.',
      },
    }));
    await act(async () => Promise.resolve());
    expect(transport.invoke.mock.calls.filter(
      ([channel]) => channel === 'session.synthesize',
    )).toHaveLength(synthesizedBeforeInterrupt);

    act(() => audio.captures[1]?.onResult({
      pcm16Base64: 'BQYHCA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.5,
      sampleCount: 2,
    }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith('Mam dodatkowe pytanie');

    act(() => transport.emit('runner.event', {
      workspaceId: 'workspace-barge-in',
      event: {
        type: 'tool_result',
        turnId: 'turn-barge-in',
        callId: 'call-barge-in',
        ok: true,
        output: 'done',
      },
    }));
    expect(result.current.activeOperations).toEqual([{
      callId: 'call-after-barge-in',
      kind: 'project-read',
      ordinal: 1,
    }]);

    act(() => transport.emit('runner.turn.complete', {
      workspaceId: 'workspace-barge-in',
      turnId: 'turn-barge-in',
      error: null,
    }));
    expect(result.current.phase).toBe('thinking');
  });

  it('keeps late assistant text in the real chat store and drains the spoken follow-up after completion', async () => {
    const workspaceId = 'workspace-barge-in-real-chat';
    let transcriptionCount = 0;
    let turnCount = 0;
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer: 'local-piper' };
      if (channel === 'chat.loadHistory') return { events: [], prevCursor: null };
      if (channel === 'session.transcribe') {
        transcriptionCount += 1;
        return transcriptionCount === 1 ? 'Pierwsze pytanie' : 'Dodatkowe pytanie';
      }
      if (channel === 'session.synthesize') {
        return { audioBase64: 'AQIDBA==', mimeType: 'audio/wav' };
      }
      if (channel === 'session.runTurn') {
        turnCount += 1;
        return { turnId: `turn-real-${turnCount}`, payload };
      }
      if (channel === 'session.abortTurn') return {};
      throw new Error(`unexpected ${channel}`);
    });
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result, unmount } = renderHook(() => {
      const currentChat = useChat(workspaceId);
      return {
        call: useVoiceCall({
          workspaceId,
          ready: true,
          chat: currentChat,
          inputRequired: false,
        }),
        chat: currentChat,
        queuedTurns: useQueuedTurns(workspaceId),
      };
    }, { wrapper: ChatBridge });

    act(() => result.current.call.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));
    await waitFor(() => expect(result.current.chat.activeTurnId).toBe('turn-real-1'));

    act(() => {
      transport.emit('runner.turn.started', { workspaceId, turnId: 'turn-real-1' });
      transport.emit('runner.event', {
        workspaceId,
        event: {
          id: 'event-real-1',
          seq: 1,
          ts: 1,
          sessionId: workspaceId,
          source: 'model',
          type: 'assistant_chunk',
          turnId: 'turn-real-1',
          delta: 'Pierwsza część. ',
        },
      });
    });
    await waitFor(() => expect(result.current.call.phase).toBe('speaking'));
    await waitFor(() => expect(audio.captures).toHaveLength(2));

    act(() => result.current.call.bargeIn());
    expect(transport.invoke).not.toHaveBeenCalledWith(
      'session.abortTurn',
      expect.anything(),
    );

    act(() => transport.emit('runner.event', {
      workspaceId,
      event: {
        id: 'event-real-2',
        seq: 2,
        ts: 2,
        sessionId: workspaceId,
        source: 'model',
        type: 'assistant_chunk',
        turnId: 'turn-real-1',
        delta: 'Pełna odpowiedź.',
      },
    }));
    await waitFor(() => expect(result.current.chat.streamingText).toBe(
      'Pierwsza część. Pełna odpowiedź.',
    ));

    act(() => audio.captures[1]?.onResult({
      pcm16Base64: 'BQYHCA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.5,
      sampleCount: 2,
    }));
    await waitFor(() => expect(result.current.queuedTurns).toEqual([{
      id: 'q-1',
      prompt: 'Dodatkowe pytanie',
    }]));
    expect(transport.invoke.mock.calls.filter(
      ([channel]) => channel === 'session.runTurn',
    )).toHaveLength(1);

    act(() => {
      transport.emit('runner.event', {
        workspaceId,
        event: {
          id: 'event-real-3',
          seq: 3,
          ts: 3,
          sessionId: workspaceId,
          source: 'model',
          type: 'assistant_message',
          turnId: 'turn-real-1',
          content: 'Pierwsza część. Pełna odpowiedź.',
          stopReason: 'end_turn',
        },
      });
      transport.emit('runner.turn.complete', {
        workspaceId,
        turnId: 'turn-real-1',
        error: null,
      });
    });

    await waitFor(() => expect(transport.invoke.mock.calls.filter(
      ([channel]) => channel === 'session.runTurn',
    )).toHaveLength(2));
    expect(transport.invoke).toHaveBeenLastCalledWith('session.runTurn', expect.objectContaining({
      workspaceId,
      prompt: 'Dodatkowe pytanie',
    }));
    expect(result.current.chat.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'assistant_message',
        content: 'Pierwsza część. Pełna odpowiedź.',
      }),
    ]));

    unmount();
    chatStore.drop(workspaceId);
  });

  it('discards the monitoring capture when spoken output finishes naturally', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: 'workspace-natural-finish',
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

    chatState = chat({ send, sending: true, activeTurnId: 'turn-natural' });
    rerender({ currentChat: chatState });
    act(() => {
      transport.emit('runner.turn.started', {
        workspaceId: 'workspace-natural-finish',
        turnId: 'turn-natural',
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-natural-finish',
        event: {
          type: 'assistant_chunk',
          turnId: 'turn-natural',
          delta: 'Ta odpowiedź kończy się naturalnie.',
        },
      });
      transport.emit('runner.turn.complete', {
        workspaceId: 'workspace-natural-finish',
        turnId: 'turn-natural',
        error: null,
      });
    });
    await waitFor(() => expect(result.current.phase).toBe('speaking'));
    await waitFor(() => expect(audio.captures).toHaveLength(2));

    act(() => audio.playback[0]?.onend?.());
    chatState = chat({ send });
    rerender({ currentChat: chatState });

    await waitFor(() => expect(audio.cancels[1]).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    await waitFor(() => expect(audio.captures).toHaveLength(3));
  });

  it('keeps the microphone muted after Moxxy finishes speaking until the user unmutes it', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const send = vi.fn(async () => undefined);
    let chatState = chat({ send });
    const { result, rerender } = renderHook(
      ({ currentChat }) => useVoiceCall({
        workspaceId: 'workspace-muted',
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

    chatState = chat({ send, sending: true, activeTurnId: 'turn-muted' });
    rerender({ currentChat: chatState });
    act(() => {
      transport.emit('runner.turn.started', {
        workspaceId: 'workspace-muted',
        turnId: 'turn-muted',
      });
      transport.emit('runner.event', {
        workspaceId: 'workspace-muted',
        event: {
          type: 'assistant_chunk',
          turnId: 'turn-muted',
          delta: 'Odpowiedź pozostaje słyszalna po wyciszeniu mikrofonu.',
        },
      });
      transport.emit('runner.turn.complete', {
        workspaceId: 'workspace-muted',
        turnId: 'turn-muted',
        error: null,
      });
    });
    await waitFor(() => expect(result.current.phase).toBe('speaking'));

    act(() => result.current.muteMicrophone());
    expect(result.current).toMatchObject({ phase: 'speaking', microphoneMuted: true });

    act(() => audio.playback[0]?.onend?.());
    chatState = chat({ send });
    rerender({ currentChat: chatState });

    await waitFor(() => expect(result.current.phase).toBe('paused'));
    expect(audio.captures).toHaveLength(2);
    expect(audio.suspends[1]).toHaveBeenCalledOnce();
    expect(audio.cancels[1]).not.toHaveBeenCalled();

    act(() => result.current.unmuteMicrophone());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(audio.resumes[1]).toHaveBeenCalledOnce();
    expect(audio.captures).toHaveLength(2);
  });

  it('mutes and unmutes an active listening capture without reacquiring the microphone', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-muted-listening',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    await waitFor(() => expect(result.current.phase).toBe('listening'));

    act(() => result.current.muteMicrophone());
    expect(result.current).toMatchObject({ phase: 'paused', microphoneMuted: true });
    expect(audio.suspends[0]).toHaveBeenCalledOnce();
    expect(audio.cancels[0]).not.toHaveBeenCalled();

    act(() => result.current.unmuteMicrophone());
    await waitFor(() => expect(result.current).toMatchObject({
      phase: 'listening',
      microphoneMuted: false,
    }));
    expect(audio.resumes[0]).toHaveBeenCalledOnce();
    expect(audio.captures).toHaveLength(1);
  });

  it('shows microphone preparation until asynchronous unmute is actually ready', async () => {
    const resumeGate = deferred<void>();
    const transport = createTransport();
    const audio = createAudioPlatform(undefined, resumeGate.promise);
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-resume-arming',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    act(() => result.current.muteMicrophone());
    act(() => result.current.unmuteMicrophone());

    expect(result.current).toMatchObject({ phase: 'arming', microphoneMuted: false });

    await act(async () => resumeGate.resolve());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(audio.captures).toHaveLength(1);
  });

  it('does not return to listening when mute supersedes a pending unmute', async () => {
    const resumeGate = deferred<void>();
    const transport = createTransport();
    const audio = createAudioPlatform(undefined, resumeGate.promise);
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-resume-race',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    act(() => result.current.muteMicrophone());
    act(() => result.current.unmuteMicrophone());
    expect(result.current.phase).toBe('arming');
    act(() => result.current.muteMicrophone());

    await act(async () => resumeGate.resolve());

    expect(result.current).toMatchObject({ phase: 'paused', microphoneMuted: true });
    expect(audio.captures).toHaveLength(1);
  });

  it('survives repeated mute and unmute cycles on one microphone stream', async () => {
    const transport = createTransport();
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-repeated-resume',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.phase).toBe('listening'));

    for (let index = 0; index < 10; index += 1) {
      act(() => result.current.muteMicrophone());
      expect(result.current).toMatchObject({ phase: 'paused', microphoneMuted: true });
      act(() => result.current.unmuteMicrophone());
      await waitFor(() => expect(result.current).toMatchObject({
        phase: 'listening',
        microphoneMuted: false,
      }));
    }

    expect(audio.captures).toHaveLength(1);
    expect(audio.suspends[0]).toHaveBeenCalledTimes(10);
    expect(audio.resumes[0]).toHaveBeenCalledTimes(10);
  });

  it('keeps a pending microphone start paused until unmute without starting a second capture', async () => {
    const transport = createTransport();
    const startGate = deferred<void>();
    const audio = createAudioPlatform(startGate.promise);
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-muted-starting',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    await waitFor(() => expect(result.current.phase).toBe('arming'));

    act(() => result.current.muteMicrophone());
    expect(result.current).toMatchObject({ phase: 'paused', microphoneMuted: true });

    await act(async () => startGate.resolve());
    expect(audio.suspends[0]).toHaveBeenCalledOnce();
    expect(audio.captures).toHaveLength(1);
    expect(result.current.phase).toBe('paused');

    act(() => result.current.unmuteMicrophone());
    expect(audio.resumes[0]).toHaveBeenCalledOnce();
    expect(audio.captures).toHaveLength(1);
    await waitFor(() => expect(result.current).toMatchObject({
      phase: 'listening',
      microphoneMuted: false,
    }));
  });

  it('refuses to start when Local Piper is not the active synthesizer', async () => {
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer: 'elevenlabs' };
      if (channel === 'voice.isLocalPiperInstalled') return true;
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
    expect(result.current.localPiperInstallRequired).toBe(false);
    expect(audio.captures).toHaveLength(0);
    expect(audio.systemSpeak).not.toHaveBeenCalled();
  });

  it('installs missing Local Piper and automatically resumes the call', async () => {
    const installation = deferred<void>();
    let installed = false;
    let activeSynthesizer = 'elevenlabs';
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer };
      if (channel === 'voice.isLocalPiperInstalled') return installed;
      if (channel === 'voice.installLocalPiper') {
        await installation.promise;
        installed = true;
        activeSynthesizer = 'local-piper';
        return undefined;
      }
      throw new Error(`unexpected ${channel}`);
    });
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-missing-piper',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.localPiperInstallRequired).toBe(true);
    expect(audio.captures).toHaveLength(0);

    act(() => result.current.installLocalPiper());
    await waitFor(() => expect(result.current.localPiperInstalling).toBe(true));
    expect(transport.invoke).toHaveBeenCalledWith('voice.installLocalPiper');

    act(() => installation.resolve(undefined));
    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(result.current.localPiperInstalling).toBe(false);
    expect(result.current.localPiperInstallRequired).toBe(false);
    await waitFor(() => expect(audio.captures).toHaveLength(1));
  });

  it('retries the transcriber probe while the runner reconnects after Piper installation', async () => {
    let installed = false;
    let postInstallTranscriberProbes = 0;
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') {
        if (!installed) return true;
        postInstallTranscriberProbes += 1;
        return postInstallTranscriberProbes >= 2;
      }
      if (channel === 'session.info') {
        return { activeSynthesizer: installed ? 'local-piper' : 'elevenlabs' };
      }
      if (channel === 'voice.isLocalPiperInstalled') return installed;
      if (channel === 'voice.installLocalPiper') {
        installed = true;
        return undefined;
      }
      throw new Error(`unexpected ${channel}`);
    });
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-reconnecting-after-piper',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.localPiperInstallRequired).toBe(true));
    act(() => result.current.installLocalPiper());

    await waitFor(() => expect(result.current.phase).toBe('listening'));
    expect(postInstallTranscriberProbes).toBe(2);
    expect(result.current.localPiperInstallRequired).toBe(false);
    await waitFor(() => expect(audio.captures).toHaveLength(1));
  });

  it('keeps the Local Piper installer available after an installation failure', async () => {
    const transport = createTransport();
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer: 'elevenlabs' };
      if (channel === 'voice.isLocalPiperInstalled') return false;
      if (channel === 'voice.installLocalPiper') throw new Error('npm download failed');
      throw new Error(`unexpected ${channel}`);
    });
    createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => useVoiceCall({
      workspaceId: 'workspace-failed-piper',
      ready: true,
      chat: chat(),
      inputRequired: false,
    }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.localPiperInstallRequired).toBe(true));
    act(() => result.current.installLocalPiper());

    await waitFor(() => expect(result.current.localPiperInstalling).toBe(false));
    expect(result.current.phase).toBe('error');
    expect(result.current.localPiperInstallRequired).toBe(true);
    expect(result.current.errorReason).toContain('npm download failed');
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

  it('surfaces a dispatch failure reported by the real useChat contract', async () => {
    const workspaceId = 'workspace-real-chat-send-failure';
    const transport = createTransport('Wywołaj błędny turn');
    transport.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'session.hasTranscriber') return true;
      if (channel === 'session.info') return { activeSynthesizer: 'local-piper' };
      if (channel === 'session.transcribe') return 'Wywołaj błędny turn';
      if (channel === 'session.runTurn') throw new Error('Runner dispatch failed');
      throw new Error(`unexpected ${channel}`);
    });
    const audio = createAudioPlatform();
    __setApiOverride(transport.api);
    const { result } = renderHook(() => {
      const currentChat = useChat(workspaceId);
      const call = useVoiceCall({
        workspaceId,
        ready: true,
        chat: currentChat,
        inputRequired: false,
      });
      return { call, currentChat };
    });

    act(() => result.current.call.open());
    await waitFor(() => expect(audio.captures).toHaveLength(1));
    act(() => audio.captures[0]?.onResult({
      pcm16Base64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
      peak: 0.4,
      sampleCount: 2,
    }));

    await waitFor(() => expect(result.current.currentChat.error).toBe('Runner dispatch failed'));
    await waitFor(() => expect(result.current.call.phase).toBe('error'));
    expect(result.current.call.errorReason).toBe('Runner dispatch failed');
    expect(audio.captures).toHaveLength(1);
  });
});
