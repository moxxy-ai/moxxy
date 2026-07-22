/**
 * audio-capture teardown tests. The capture surface owns the live mic, the
 * AudioContext and the MediaRecorder, so its error/teardown invariants are the
 * package's main correctness risk:
 *  - MediaRecorder ctor throws after getUserMedia → mic tracks stopped.
 *  - getUserMedia rejects → start() rejects, nothing leaks.
 *  - analyser setup throws AFTER rec.start() → tracks stopped, recorder
 *    stopped, and crucially NO late onResult (the 'stop' the recorder later
 *    emits must not run finalize for a start() that already rejected).
 *  - normal stop → finalize fires onResult exactly once.
 *  - cancel → releases every resource without producing a transcription blob.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { trimPcm16Start, webAudioCapture } from './audio-capture.js';
import type { AudioCaptureStartOptions } from '@moxxy/client-core';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeStream(stops: ReadonlyArray<() => void>): MediaStream {
  return {
    getTracks: () => stops.map((stop) => ({ stop })),
  } as unknown as MediaStream;
}

/** A controllable MediaRecorder fake that records its listeners so a test can
 *  both dispatch events and assert that the lifecycle listeners were removed. */
class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  stopCalls = 0;
  private listeners = new Map<string, Set<(ev: unknown) => void>>();
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.stopCalls++;
    this.state = 'inactive';
  }
  /** Test-only: re-dispatch a 'stop' as the real recorder would when its tracks
   *  end, to prove no stale handler fires. */
  dispatch(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function installRecorder(rec: FakeRecorder): void {
  const Ctor = vi.fn(() => rec) as unknown as typeof MediaRecorder;
  (Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => false;
  vi.stubGlobal('MediaRecorder', Ctor);
}

const noopOpts: AudioCaptureStartOptions = {
  onResult: () => {},
  onError: () => {},
};

describe('webAudioCapture.start', () => {
  it('requests browser audio processing suitable for barge-in', async () => {
    const getUserMedia = vi.fn(async () => fakeStream([vi.fn()]));
    const rec = new FakeRecorder();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('window', {});
    installRecorder(rec);

    const handle = await webAudioCapture.start(noopOpts);

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
    expect(handle.markUtteranceStart).toEqual(expect.any(Function));
    handle.cancel();
  });

  it('trims complete PCM16 frames before the marked utterance', () => {
    const pcm = new Uint8Array(24_000 * 2);
    for (let index = 0; index < pcm.length; index += 1) pcm[index] = index % 251;

    const trimmed = trimPcm16Start(pcm, 250);

    expect(trimmed.byteLength).toBe(18_000 * 2);
    expect(trimmed[0]).toBe(pcm[12_000]);
    expect(trimmed[1]).toBe(pcm[12_001]);
  });

  it('stops the mic tracks when the MediaRecorder constructor throws', async () => {
    const stop = vi.fn();
    const stream = fakeStream([stop, stop]);

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal('window', {});
    const Ctor = vi.fn(() => {
      throw new Error('unsupported mimeType');
    }) as unknown as typeof MediaRecorder;
    (Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => false;
    vi.stubGlobal('MediaRecorder', Ctor);

    await expect(webAudioCapture.start(noopOpts)).rejects.toThrow('unsupported mimeType');
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('rejects without leaking tracks when getUserMedia rejects', async () => {
    const getUserMedia = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('window', {});

    await expect(webAudioCapture.start(noopOpts)).rejects.toThrow('NotAllowedError');
    // No stream ever resolved, so there is nothing to leak — and start threw
    // before constructing any recorder.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('analyser setup throwing after rec.start() stops tracks, stops the recorder, and fires NO late onResult', async () => {
    const stop = vi.fn();
    const stream = fakeStream([stop]);
    const rec = new FakeRecorder();

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    // AudioContext ctor throws → analyser setup fails after rec.start() succeeded.
    const AudioContextCtor = vi.fn(() => {
      throw new Error('audio context unavailable');
    });
    vi.stubGlobal('window', { AudioContext: AudioContextCtor });
    installRecorder(rec);

    const onResult = vi.fn();
    const onError = vi.fn();
    const onAnalyser = vi.fn();

    await expect(
      webAudioCapture.start({ onResult, onError, onAnalyser }),
    ).rejects.toThrow('audio context unavailable');

    // Mic released, recorder stopped, lifecycle listeners removed.
    expect(stop).toHaveBeenCalledTimes(1);
    expect(rec.stopCalls).toBe(1);
    expect(rec.listenerCount('stop')).toBe(0);
    expect(rec.listenerCount('dataavailable')).toBe(0);

    // The recorder later emits 'stop' (tracks ended); the stale handler must NOT
    // run finalize → onResult for a start() that already rejected.
    rec.dispatch('stop', {});
    await Promise.resolve();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('a normal stop with empty chunks fires onResult exactly once with sampleCount 0', async () => {
    const stop = vi.fn();
    const stream = fakeStream([stop]);
    const rec = new FakeRecorder();

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal('window', {}); // no AudioContext → analyser branch skipped cleanly
    installRecorder(rec);

    const onResult = vi.fn();
    const onError = vi.fn();
    const handle = await webAudioCapture.start({ onResult, onError });

    handle.stop();
    expect(rec.stopCalls).toBe(1);

    // The recorder signals completion via 'stop'; finalize runs with no chunks.
    rec.dispatch('stop', {});
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ pcm16Base64: '', sampleCount: 0, peak: 0 });
    // Mic released on stop.
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('cancel releases the microphone and analyser without finalizing audio', async () => {
    const stop = vi.fn();
    const close = vi.fn(async () => undefined);
    const analyser = { fftSize: 0, smoothingTimeConstant: 0 };
    const stream = fakeStream([stop]);
    const rec = new FakeRecorder();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onAnalyser = vi.fn();

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal('window', {
      AudioContext: vi.fn(() => ({
        createAnalyser: () => analyser,
        createMediaStreamSource: () => ({ connect: vi.fn() }),
        close,
      })),
    });
    installRecorder(rec);

    const handle = await webAudioCapture.start({ onResult, onError, onAnalyser });
    expect(onAnalyser).toHaveBeenCalledWith(analyser);

    handle.cancel();
    rec.dispatch('stop', {});
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(onAnalyser).toHaveBeenLastCalledWith(null);
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
