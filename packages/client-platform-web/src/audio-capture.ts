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
  MOXXY_PCM16_SAMPLE_RATE,
  getAudioContextCtor,
} from './pcm16.js';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const DEFAULT_UTTERANCE_PRE_ROLL_MS = 240;

export function trimPcm16Start(bytes: Uint8Array, startMs: number): Uint8Array {
  if (!Number.isFinite(startMs) || startMs <= 0 || bytes.byteLength === 0) return bytes;
  const requestedFrames = Math.floor((startMs / 1_000) * MOXXY_PCM16_SAMPLE_RATE);
  const availableFrames = Math.floor(bytes.byteLength / 2);
  const startFrame = Math.min(requestedFrames, availableFrames);
  return bytes.slice(startFrame * 2);
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
    let audioCtx: AudioContext | null = null;
    let released = false;
    let captureStartedAt = 0;
    let trimBeforeMs: number | null = null;

    // Stop the live mic tracks + tear down the audio context. Called from the
    // 'stop' handler AND from the synchronous-failure path below — if the
    // MediaRecorder ctor or analyser setup throws after getUserMedia resolved,
    // the stream would otherwise stay held (OS mic indicator stuck on).
    const teardown = (): void => {
      if (released) return;
      released = true;
      stream.getTracks().forEach((t) => t.stop());
      if (audioCtx) void audioCtx.close().catch(() => undefined);
      audioCtx = null;
      opts.onAnalyser?.(null);
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
        const decodedPcm = await audioToPcm16(blob);
        const pcm = trimPcm16Start(decodedPcm, trimBeforeMs ?? 0);
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

    const onData = (ev: BlobEvent): void => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    const onStop = (): void => {
      teardown();
      void finalize();
    };
    rec.addEventListener('dataavailable', onData);
    rec.addEventListener('stop', onStop);

    try {
      captureStartedAt = monotonicNow();
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
      // Drop the lifecycle listeners FIRST so the 'stop' the recorder emits
      // below can't fire onStop → finalize → opts.onResult for a start() that
      // already rejected (the caller's await threw and moved to phase 'error').
      rec.removeEventListener('dataavailable', onData);
      rec.removeEventListener('stop', onStop);
      // Stop the recorder too — otherwise it's left 'recording' with no handle
      // returned (orphaned, unstoppable).
      if (rec.state === 'recording') {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }
      teardown();
      throw e;
    }

    let cancelled = false;
    const stopRecorder = (): void => {
      if (rec.state === 'recording') rec.stop();
    };
    return {
      stop(): void {
        if (cancelled) return;
        stopRecorder();
      },
      cancel(): void {
        if (cancelled) return;
        cancelled = true;
        rec.removeEventListener('dataavailable', onData);
        rec.removeEventListener('stop', onStop);
        stopRecorder();
        teardown();
      },
      markUtteranceStart(preRollMs = DEFAULT_UTTERANCE_PRE_ROLL_MS): void {
        if (cancelled || trimBeforeMs !== null) return;
        const safePreRoll = Number.isFinite(preRollMs) ? Math.max(0, preRollMs) : 0;
        trimBeforeMs = Math.max(0, monotonicNow() - captureStartedAt - safePreRoll);
      },
    };
  },
};
