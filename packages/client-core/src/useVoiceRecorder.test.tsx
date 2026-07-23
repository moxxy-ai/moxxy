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
  const suspend = vi.fn();
  const resume = vi.fn();
  const markUtteranceStart = vi.fn();
  configurePlatform({
    audioCapture: {
      isSupported: () => true,
      start: async (next) => {
        options = next;
        return { stop, cancel, suspend, resume, markUtteranceStart };
      },
    },
  });
  return {
    stop,
    cancel,
    suspend,
    resume,
    markUtteranceStart,
    options: (): AudioCaptureStartOptions => {
      if (!options) throw new Error('recorder was not started');
      return options;
    },
  };
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolvePromise) throw new Error('deferred promise is not initialized');
      resolvePromise(value);
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

  it('suspends and resumes an active capture without acquiring another microphone', async () => {
    const recorder = installRecorder();
    const { result } = renderHook(() =>
      useVoiceRecorder({ workspaceId: 'workspace-a', onTranscript: vi.fn() }),
    );

    await act(async () => result.current.start());
    act(() => result.current.suspend());

    expect(result.current.phase).toBe('paused');
    expect(recorder.suspend).toHaveBeenCalledOnce();
    expect(recorder.cancel).not.toHaveBeenCalled();

    await act(async () => result.current.resume());

    expect(result.current.phase).toBe('recording');
    expect(recorder.resume).toHaveBeenCalledOnce();
  });

  it('reacquires capture when a platform cannot suspend the existing stream', async () => {
    const cancel = vi.fn();
    const start = vi.fn(async () => ({ stop: vi.fn(), cancel }));
    configurePlatform({ audioCapture: { isSupported: () => true, start } });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    await act(async () => result.current.start());
    act(() => result.current.suspend());

    expect(cancel).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe('idle');

    await act(async () => result.current.resume());

    expect(start).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe('recording');
  });

  it('stays paused and reports preparation until asynchronous microphone resume completes', async () => {
    const resumeGate = deferred<void>();
    const resume = vi.fn(() => resumeGate.promise);
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => ({
          stop: vi.fn(),
          cancel: vi.fn(),
          suspend: vi.fn(),
          resume,
        }),
      },
    });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    await act(async () => result.current.start());
    act(() => result.current.suspend());
    let resumePromise: Promise<void> | undefined;
    act(() => {
      resumePromise = result.current.resume();
    });

    expect(result.current).toMatchObject({ phase: 'paused', starting: true });

    await act(async () => {
      resumeGate.resolve();
      await resumePromise;
    });

    expect(result.current).toMatchObject({ phase: 'recording', starting: false });
  });

  it('keeps capture paused when mute supersedes an asynchronous resume', async () => {
    const resumeGate = deferred<void>();
    const suspend = vi.fn();
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => ({
          stop: vi.fn(),
          cancel: vi.fn(),
          suspend,
          resume: vi.fn(() => resumeGate.promise),
        }),
      },
    });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    await act(async () => result.current.start());
    act(() => result.current.suspend());
    let resumePromise: Promise<void> | undefined;
    act(() => {
      resumePromise = result.current.resume();
    });
    act(() => result.current.suspend());
    await act(async () => {
      resumeGate.resolve();
      await resumePromise;
    });

    expect(result.current).toMatchObject({ phase: 'paused', starting: false });
    expect(suspend).toHaveBeenCalledTimes(2);
  });

  it('honours mute while microphone acquisition is pending and resumes the same capture', async () => {
    let resolveStart: ((handle: AudioRecordingHandle) => void) | undefined;
    const handle: AudioRecordingHandle = {
      stop: vi.fn(),
      cancel: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
    };
    const start = vi.fn(() => new Promise<AudioRecordingHandle>((resolve) => {
      resolveStart = resolve;
    }));
    configurePlatform({ audioCapture: { isSupported: () => true, start } });
    const { result } = renderHook(() => useVoiceRecorder({
      workspaceId: 'workspace-a',
      onTranscript: vi.fn(),
    }));

    act(() => result.current.start());
    expect(result.current).toMatchObject({ phase: 'idle', starting: true });

    act(() => result.current.suspend());
    expect(result.current.phase).toBe('paused');

    await act(async () => resolveStart?.(handle));
    expect(handle.suspend).toHaveBeenCalledOnce();
    expect(handle.cancel).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('paused');

    await act(async () => result.current.resume());
    expect(handle.resume).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe('recording');
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
