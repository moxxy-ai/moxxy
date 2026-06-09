import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { getPlatform, type AudioCaptureResult, type AudioRecordingHandle } from './platform.js';

/**
 * Push-to-record voice capture, shared by the composer (appends the transcript
 * to the draft) and the focus widget (sends it as a turn). It owns the *phase*
 * machine — idle → recording → transcribing → error — and the `session.transcribe`
 * round-trip, while the platform {@link AudioCapture} capability owns the actual
 * mic pipeline (getUserMedia → recorder → PCM16). With no capability registered,
 * the recorder degrades to a clean "mic unavailable" error.
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

const ERROR_RESET_MS = 2500;

export interface VoiceRecorderOptions {
  /** Called with the recognised text after a successful transcription. */
  readonly onTranscript: (text: string) => void;
  /** Optional: receives the live analyser while recording (opaque — the web
   *  capability passes an `AnalyserNode`), then null when recording ends. */
  readonly onAnalyser?: (analyser: unknown | null) => void;
}

export function useVoiceRecorder(opts: VoiceRecorderOptions): UseVoiceRecorder {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const handleRef = useRef<AudioRecordingHandle | null>(null);
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
      if (errorTimerRef.current !== undefined) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => {
        setPhase('idle');
        setErrorReason(null);
      }, ERROR_RESET_MS);
    },
    [setPhase],
  );

  const finalize = useCallback(
    async (result: AudioCaptureResult): Promise<void> => {
      setPhase('transcribing');
      try {
        // Nothing captured (an instant tap, a muted mic) — don't round-trip
        // empty audio to the transcriber; just tell the user plainly.
        if (result.sampleCount === 0) {
          fail('No speech detected — try again');
          return;
        }
        // A captured-but-silent clip means the mic track resolved yet carried
        // only zeros — almost always mic access denied / muted / wrong input
        // device, NOT "you didn't speak". Surface that instead of a useless
        // round-trip to the transcriber (which would just return empty text).
        if (result.peak < 0.005) {
          fail('No sound from the microphone — check microphone access and the selected input device.');
          return;
        }
        const text = await api().invoke('session.transcribe', {
          audioBase64: result.pcm16Base64,
          mimeType: result.mimeType,
        });
        const trimmed = text?.trim();
        if (trimmed) {
          onTranscriptRef.current(trimmed);
          setPhase('idle');
        } else {
          // A well-formed but empty transcript means the clip held no
          // intelligible speech. Surface a hint instead of silently dropping it.
          fail('No speech detected — try again');
        }
      } catch (e) {
        // Decode the IPC error envelope so the user sees a clean message
        // (a login hint, a network error, …) rather than the raw wire encoding.
        fail(toErrorMessage(e));
      }
    },
    [fail, setPhase],
  );

  const stop = useCallback((): void => {
    handleRef.current?.stop();
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (phaseRef.current !== 'idle' || handleRef.current) return;
    const audio = getPlatform().audioCapture;
    if (!audio?.isSupported()) {
      fail('mic unavailable');
      return;
    }
    try {
      const handle = await audio.start({
        onResult: (result) => {
          handleRef.current = null;
          void finalize(result);
        },
        onError: (message) => {
          handleRef.current = null;
          fail(message);
        },
        ...(onAnalyserRef.current ? { onAnalyser: onAnalyserRef.current } : {}),
      });
      handleRef.current = handle;
      setPhase('recording');
    } catch (e) {
      fail(e instanceof Error ? e.message : 'mic unavailable');
    }
  }, [fail, finalize, setPhase]);

  const toggle = useCallback((): void => {
    if (phaseRef.current === 'recording') stop();
    else void start();
  }, [start, stop]);

  // Tear down the mic + cancel the pending error-reset timer on unmount.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
      if (errorTimerRef.current !== undefined) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return { phase, errorReason, toggle, start: () => void start(), stop };
}
