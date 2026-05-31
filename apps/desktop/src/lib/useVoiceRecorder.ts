import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { toErrorMessage } from './errors';
import { audioToPcm16, uint8ArrayToBase64, MOXXY_PCM16_24KHZ_MIME } from './audioToPcm16';

/**
 * Push-to-record voice capture, shared by the composer (appends the
 * transcript to the draft) and the focus widget (sends it as a turn).
 * Owns the whole pipeline once — getUserMedia → MediaRecorder → PCM16
 * conversion → `session.transcribe` — so the two surfaces can't drift
 * (they previously had 2500 ms vs 1800 ms error resets and a re-rolled
 * webkitAudioContext probe).
 */

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'error';

export interface UseVoiceRecorder {
  readonly phase: VoicePhase;
  /** Human-readable reason while `phase === 'error'`, else null. */
  readonly errorReason: string | null;
  /** Start if idle, stop if recording. */
  readonly toggle: () => void;
  readonly start: () => void;
  readonly stop: () => void;
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const ERROR_RESET_MS = 2500;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export interface VoiceRecorderOptions {
  /** Called with the recognised text after a successful transcription. */
  readonly onTranscript: (text: string) => void;
  /** Optional: receives the live AnalyserNode while recording (for a
   *  spectrum visualiser), then null when recording ends. */
  readonly onAnalyser?: (analyser: AnalyserNode | null) => void;
}

export function useVoiceRecorder(opts: VoiceRecorderOptions): UseVoiceRecorder {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  // The error→idle reset timer, tracked so it can't fire setState after the
  // component unmounts (and so a rapid second failure doesn't stack timers).
  const errorTimerRef = useRef<number | undefined>(undefined);
  // Latest callbacks in refs so the stable start/stop closures see them.
  const onTranscriptRef = useRef(opts.onTranscript);
  const onAnalyserRef = useRef(opts.onAnalyser);
  onTranscriptRef.current = opts.onTranscript;
  onAnalyserRef.current = opts.onAnalyser;

  const setPhase = useCallback((p: VoicePhase): void => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const fail = useCallback(
    (reason: string): void => {
      setErrorReason(reason);
      setPhase('error');
      if (errorTimerRef.current !== undefined) window.clearTimeout(errorTimerRef.current);
      errorTimerRef.current = window.setTimeout(() => {
        setPhase('idle');
        setErrorReason(null);
      }, ERROR_RESET_MS);
    },
    [setPhase],
  );

  const releaseAudio = useCallback((): void => {
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    onAnalyserRef.current?.(null);
  }, []);

  const finalize = useCallback(
    async (chunks: Blob[], mimeType: string): Promise<void> => {
      setPhase('transcribing');
      try {
        const blob = new Blob([...chunks], { type: mimeType });
        // Nothing captured (an instant tap, a muted mic) — don't round-trip
        // empty audio to the transcriber; just tell the user plainly.
        if (blob.size === 0) {
          fail('No speech detected — try again');
          return;
        }
        // PCM16 mono 24 kHz — the format moxxy's Codex transcriber
        // expects; AudioContext stands in for the TUI's ffmpeg step.
        const pcm = await audioToPcm16(blob);
        if (pcm.length === 0) {
          fail('No speech detected — try again');
          return;
        }
        const text = await api().invoke('session.transcribe', {
          audioBase64: uint8ArrayToBase64(pcm),
          mimeType: MOXXY_PCM16_24KHZ_MIME,
        });
        const trimmed = text?.trim();
        if (trimmed) {
          onTranscriptRef.current(trimmed);
          setPhase('idle');
        } else {
          // A well-formed but empty transcript means the clip held no
          // intelligible speech. Surface a hint instead of silently dropping it
          // (mirrors the TUI's "voice: empty transcript" notice).
          fail('No speech detected — try again');
        }
      } catch (e) {
        // Decode the IPC error envelope so the user sees a clean message
        // (a login hint, a network error, …) rather than the raw
        // `MOXXY_IPC_ERR:{…}` wire encoding Electron would otherwise surface.
        fail(toErrorMessage(e));
      }
    },
    [fail, setPhase],
  );

  const stop = useCallback((): void => {
    const rec = recorderRef.current;
    if (rec?.state === 'recording') rec.stop();
    recorderRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== 'idle' || recorderRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.addEventListener('dataavailable', (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      });
      rec.addEventListener('stop', () => {
        stream.getTracks().forEach((t) => t.stop());
        releaseAudio();
        void finalize(chunks, rec.mimeType);
      });
      rec.start();
      recorderRef.current = rec;
      setPhase('recording');

      // Optional spectrum analyser for the focus widget.
      if (onAnalyserRef.current) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          audioContextRef.current = ctx;
          const an = ctx.createAnalyser();
          an.fftSize = 256;
          an.smoothingTimeConstant = 0.7;
          ctx.createMediaStreamSource(stream).connect(an);
          onAnalyserRef.current(an);
        }
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : 'mic unavailable');
    }
  }, [fail, finalize, releaseAudio, setPhase]);

  const toggle = useCallback((): void => {
    if (recorderRef.current?.state === 'recording') stop();
    else void start();
  }, [start, stop]);

  // Tear down the mic + cancel the pending error-reset timer on unmount.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec?.state === 'recording') rec.stop();
      recorderRef.current = null;
      audioContextRef.current?.close().catch(() => undefined);
      if (errorTimerRef.current !== undefined) window.clearTimeout(errorTimerRef.current);
    };
  }, []);

  return { phase, errorReason, toggle, start: () => void start(), stop };
}
