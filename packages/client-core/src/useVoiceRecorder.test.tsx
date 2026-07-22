import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  configurePlatform,
  type AudioCaptureStartOptions,
  type AudioRecordingHandle,
} from './platform.js';
import { __setApiOverride } from './transport.js';
import { useVoiceRecorder } from './useVoiceRecorder.js';

afterEach(() => {
  configurePlatform({});
  __setApiOverride(null);
});

function installRecorder() {
  let options: AudioCaptureStartOptions | null = null;
  const stop = vi.fn();
  const cancel = vi.fn();
  const markUtteranceStart = vi.fn();
  configurePlatform({
    audioCapture: {
      isSupported: () => true,
      start: async (next) => {
        options = next;
        return { stop, cancel, markUtteranceStart };
      },
    },
  });
  return {
    stop,
    cancel,
    markUtteranceStart,
    options: (): AudioCaptureStartOptions => {
      if (!options) throw new Error('recorder was not started');
      return options;
    },
  };
}

describe('useVoiceRecorder', () => {
  it('pins transcription to the workspace that started the capture', async () => {
    const recorder = installRecorder();
    const invoke = vi.fn(async () => 'Cześć z transkrypcji');
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
    const onTranscript = vi.fn();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useVoiceRecorder({ workspaceId, onTranscript }),
      { initialProps: { workspaceId: 'workspace-a' } },
    );

    await act(async () => result.current.start());
    rerender({ workspaceId: 'workspace-b' });
    act(() => {
      recorder.options().onResult({
        pcm16Base64: 'AQIDBA==',
        mimeType: 'audio/x-moxxy-pcm16-24khz',
        peak: 0.4,
        sampleCount: 2,
      });
    });

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Cześć z transkrypcji'));
    expect(invoke).toHaveBeenCalledWith('session.transcribe', {
      workspaceId: 'workspace-a',
      audioBase64: 'AQIDBA==',
      mimeType: 'audio/x-moxxy-pcm16-24khz',
    });
  });

  it('cancels without transcribing and resets to idle', async () => {
    const recorder = installRecorder();
    const invoke = vi.fn();
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
    const { result } = renderHook(() =>
      useVoiceRecorder({ workspaceId: 'workspace-a', onTranscript: vi.fn() }),
    );

    await act(async () => result.current.start());
    expect(result.current.phase).toBe('recording');
    act(() => result.current.cancel());

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });

  it('forwards the confirmed utterance boundary to the platform capture', async () => {
    const recorder = installRecorder();
    const { result } = renderHook(() =>
      useVoiceRecorder({ workspaceId: 'workspace-a', onTranscript: vi.fn() }),
    );

    await act(async () => result.current.start());
    act(() => result.current.markUtteranceStart());

    expect(recorder.markUtteranceStart).toHaveBeenCalledOnce();
  });

  it('starts at most one microphone capture while permission is pending', async () => {
    let resolveStart: ((handle: AudioRecordingHandle) => void) | undefined;
    const start = vi.fn(() => new Promise<AudioRecordingHandle>((resolve) => {
      resolveStart = resolve;
    }));
    configurePlatform({ audioCapture: { isSupported: () => true, start } });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    act(() => {
      result.current.start();
      result.current.start();
    });
    expect(start).toHaveBeenCalledOnce();

    await act(async () => resolveStart?.({ stop: vi.fn(), cancel: vi.fn() }));
    expect(result.current.phase).toBe('recording');
  });

  it('discards an active capture on unmount instead of finalizing it', async () => {
    const recorder = installRecorder();
    __setApiOverride({ invoke: vi.fn(), subscribe: () => () => undefined } as never);
    const { result, unmount } = renderHook(() =>
      useVoiceRecorder({ workspaceId: 'workspace-a', onTranscript: vi.fn() }),
    );

    await act(async () => result.current.start());
    unmount();

    expect(recorder.cancel).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it('cancels a microphone handle that resolves after the capture was discarded', async () => {
    let resolveStart: ((handle: AudioRecordingHandle) => void) | undefined;
    const lateHandle: AudioRecordingHandle = {
      stop: vi.fn(),
      cancel: vi.fn(),
    };
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: () => new Promise((resolve) => {
          resolveStart = resolve;
        }),
      },
    });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    act(() => result.current.start());
    act(() => result.current.cancel());
    await act(async () => resolveStart?.(lateHandle));

    expect(lateHandle.cancel).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe('idle');
  });
});
