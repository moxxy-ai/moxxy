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

async function ensureAudioContextRunning(context: AudioContext): Promise<void> {
  if (context.state === 'running') return;
  await context.resume();
  const stateAfterResume = (): AudioContextState => context.state;
  if (stateAfterResume() !== 'running') {
    throw new Error('microphone audio context did not resume');
  }
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
    let analyser: AnalyserNode | null = null;
    let released = false;
    let suspended = false;
    let cancelled = false;
    let stopping = false;
    let resumeGeneration = 0;
    let captureStartedAt = 0;
    let trimBeforeMs: number | null = null;

    interface RecorderSession {
      readonly recorder: MediaRecorder;
      readonly chunks: Blob[];
      readonly onData: (event: BlobEvent) => void;
      readonly onStop: () => void;
    }

    let recorderSession: RecorderSession | null = null;

    const setTracksEnabled = (enabled: boolean): void => {
      for (const track of stream.getTracks()) track.enabled = enabled;
    };

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

    const finalize = async (recorder: MediaRecorder, chunks: ReadonlyArray<Blob>): Promise<void> => {
      try {
        const blob = new Blob([...chunks], { type: recorder.mimeType });
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

    const detachRecorder = (session: RecorderSession): void => {
      session.recorder.removeEventListener('dataavailable', session.onData);
      session.recorder.removeEventListener('stop', session.onStop);
    };

    const stopWithoutResult = (): void => {
      const session = recorderSession;
      recorderSession = null;
      stopping = false;
      if (!session) return;
      detachRecorder(session);
      if (session.recorder.state !== 'inactive') {
        try {
          session.recorder.stop();
        } catch {
          /* recorder already stopped */
        }
      }
    };

    const startRecorder = (): void => {
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      const session: RecorderSession = {
        recorder,
        chunks,
        onData: (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        },
        onStop: () => {
          if (recorderSession === session) recorderSession = null;
          detachRecorder(session);
          teardown();
          void finalize(recorder, chunks);
        },
      };
      recorderSession = session;
      stopping = false;
      recorder.addEventListener('dataavailable', session.onData);
      recorder.addEventListener('stop', session.onStop);
      captureStartedAt = monotonicNow();
      trimBeforeMs = null;
      try {
        recorder.start();
      } catch (error) {
        recorderSession = null;
        detachRecorder(session);
        throw error;
      }
    };

    try {
      startRecorder();

      // Optional spectrum analyser for the focus widget.
      if (opts.onAnalyser) {
        const Ctor = getAudioContextCtor();
        if (Ctor) {
          const ctx = new Ctor();
          audioCtx = ctx;
          if (ctx.state !== 'running') {
            setTracksEnabled(false);
            await ensureAudioContextRunning(ctx);
            setTracksEnabled(true);
          }
          const an = ctx.createAnalyser();
          analyser = an;
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
      stopWithoutResult();
      teardown();
      throw e;
    }

    return {
      stop(): void {
        if (cancelled || suspended) return;
        const session = recorderSession;
        if (session && session.recorder.state !== 'inactive') {
          stopping = true;
          session.recorder.stop();
        }
      },
      cancel(): void {
        if (cancelled) return;
        cancelled = true;
        resumeGeneration += 1;
        stopWithoutResult();
        teardown();
      },
      suspend(): void {
        if (cancelled) return;
        resumeGeneration += 1;
        if (suspended) {
          setTracksEnabled(false);
          return;
        }
        suspended = true;
        setTracksEnabled(false);
        if (!stopping) stopWithoutResult();
        opts.onAnalyser?.(null);
      },
      async resume(): Promise<void> {
        if (cancelled || !suspended) return;
        const generation = resumeGeneration + 1;
        resumeGeneration = generation;
        try {
          if (audioCtx) await ensureAudioContextRunning(audioCtx);
          if (cancelled || !suspended || generation !== resumeGeneration) return;
          setTracksEnabled(true);
          if (!stopping) startRecorder();
          suspended = false;
          if (analyser) opts.onAnalyser?.(analyser);
        } catch (error) {
          if (generation !== resumeGeneration) return;
          cancelled = true;
          setTracksEnabled(false);
          teardown();
          throw error;
        }
      },
      markUtteranceStart(preRollMs = DEFAULT_UTTERANCE_PRE_ROLL_MS): void {
        if (cancelled || suspended || trimBeforeMs !== null) return;
        const safePreRoll = Number.isFinite(preRollMs) ? Math.max(0, preRollMs) : 0;
        trimBeforeMs = Math.max(0, monotonicNow() - captureStartedAt - safePreRoll);
      },
    };
  },
};
