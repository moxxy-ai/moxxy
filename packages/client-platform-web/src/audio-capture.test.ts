/**
 * audio-capture teardown test — if the MediaRecorder constructor throws after
 * getUserMedia() resolved, start() must stop the live mic tracks before
 * rethrowing so the OS mic indicator doesn't stay stuck on (the stream is only
 * stopped from the 'stop' event handler, which never fires when construction
 * throws first).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { webAudioCapture } from './audio-capture.js';
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

const noopOpts: AudioCaptureStartOptions = {
  onResult: () => {},
  onError: () => {},
};

describe('webAudioCapture.start', () => {
  it('stops the mic tracks when the MediaRecorder constructor throws', async () => {
    const stop = vi.fn();
    const stream = fakeStream([stop, stop]);

    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal('window', {});
    // MediaRecorder ctor throws; isTypeSupported → false so pickMimeType → undefined.
    const Ctor = vi.fn(() => {
      throw new Error('unsupported mimeType');
    }) as unknown as typeof MediaRecorder;
    (Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => false;
    vi.stubGlobal('MediaRecorder', Ctor);

    await expect(webAudioCapture.start(noopOpts)).rejects.toThrow('unsupported mimeType');
    // Both tracks stopped — no leaked mic.
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
