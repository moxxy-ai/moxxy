/**
 * Web implementation of the {@link AudioCapture} capability: getUserMedia →
 * MediaRecorder → (on stop) PCM16 re-encode, with an optional live AnalyserNode
 * for the focus widget's spectrum visualiser. Owns the whole mic pipeline so the
 * `useVoiceRecorder` hook can stay DOM-free and just drive the phase machine.
 */

import type {
  AudioCapture,
  AudioCaptureStartOptions,
  AudioRecordingHandle,
} from '@moxxy/client-core';
import {
  audioToPcm16,
  pcm16Peak,
  uint8ArrayToBase64,
  MOXXY_PCM16_24KHZ_MIME,
  getAudioContextCtor,
} from './pcm16.js';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export const webAudioCapture: AudioCapture = {
  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  },

  async start(opts: AudioCaptureStartOptions): Promise<AudioRecordingHandle> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let audioCtx: AudioContext | null = null;

    // Stop the live mic tracks + tear down the audio context. Called from the
    // 'stop' handler AND from the synchronous-failure path below — if the
    // MediaRecorder ctor or analyser setup throws after getUserMedia resolved,
    // the stream would otherwise stay held (OS mic indicator stuck on).
    const teardown = (): void => {
      stream.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => undefined);
      audioCtx = null;
    };

    let rec: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      teardown();
      throw e;
    }
    const chunks: Blob[] = [];

    const finalize = async (): Promise<void> => {
      try {
        const blob = new Blob([...chunks], { type: rec.mimeType });
        if (blob.size === 0) {
          opts.onResult({ pcm16Base64: '', mimeType: MOXXY_PCM16_24KHZ_MIME, peak: 0, sampleCount: 0 });
          return;
        }
        const pcm = await audioToPcm16(blob);
        opts.onResult({
          pcm16Base64: pcm.length > 0 ? uint8ArrayToBase64(pcm) : '',
          mimeType: MOXXY_PCM16_24KHZ_MIME,
          peak: pcm16Peak(pcm),
          sampleCount: Math.floor(pcm.byteLength / 2),
        });
      } catch (e) {
        opts.onError(e instanceof Error ? e.message : 'could not process audio');
      }
    };

    rec.addEventListener('dataavailable', (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    });
    rec.addEventListener('stop', () => {
      teardown();
      opts.onAnalyser?.(null);
      void finalize();
    });

    try {
      rec.start();

      // Optional spectrum analyser for the focus widget.
      if (opts.onAnalyser) {
        const Ctor = getAudioContextCtor();
        if (Ctor) {
          const ctx = new Ctor();
          audioCtx = ctx;
          const an = ctx.createAnalyser();
          an.fftSize = 256;
          an.smoothingTimeConstant = 0.7;
          ctx.createMediaStreamSource(stream).connect(an);
          opts.onAnalyser(an);
        }
      }
    } catch (e) {
      teardown();
      throw e;
    }

    return {
      stop(): void {
        if (rec.state === 'recording') rec.stop();
      },
    };
  },
};
