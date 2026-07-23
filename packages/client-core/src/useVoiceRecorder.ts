import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import { getPlatform, type AudioCaptureResult, type AudioRecordingHandle } from './platform.js';

/**
 * Push-to-record voice capture, shared by the composer (appends the transcript
 * to the draft) and the focus widget (sends it as a turn). It owns the *phase*
 * machine — idle → recording → transcribing → error — and the `session.transcribe`
 * round-trip, while the platform {@link AudioCapture} capability owns the actual
 * mic pipeline (getUserMedia → recorder → PCM16). A platform may suspend the
 * current utterance while retaining the allocated stream for an immediate,
 * privacy-safe resume. With no capability registered, the recorder degrades
 * to a clean "mic unavailable" error.
 */

export type VoicePhase =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'transcribing'
  | 'error';

export interface UseVoiceRecorder {
  readonly phase: VoicePhase;
  readonly starting: boolean;
  /** Human-readable reason while `phase === 'error'`, else null. */
  readonly errorReason: string | null;
  /** Start if idle, stop if recording. */
  readonly toggle: () => void;
  readonly start: () => void;
  readonly stop: () => void;
  /** Discard the current utterance without releasing an allocated mic stream. */
  readonly suspend: () => void;
  /** Resume with a fresh utterance on the retained mic stream. */
  readonly resume: () => Promise<void>;
  /** Discard the current capture or in-flight transcription. */
  readonly cancel: () => void;
  /** Keep only the detected utterance plus a short pre-roll from a monitor capture. */
  readonly markUtteranceStart: () => void;
}

const ERROR_RESET_MS = 2500;

export interface VoiceRecorderOptions {
  /** Session that owns the capture. Pinned when recording starts. */
  readonly workspaceId?: string;
  /** Called with the recognised text after a successful transcription. */
  readonly onTranscript: (text: string) => void;
  /** Optional: receives the live analyser while recording (opaque — the web
   *  capability passes an `AnalyserNode`), then null when recording ends. */
  readonly onAnalyser?: (analyser: unknown | null) => void;
}

export function useVoiceRecorder(opts: VoiceRecorderOptions): UseVoiceRecorder {
  const [phase, setPhaseState] = useState<VoicePhase>('idle');
  const [starting, setStarting] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const handleRef = useRef<AudioRecordingHandle | null>(null);
  const startingGenerationRef = useRef<number | null>(null);
  const resumeAttemptRef = useRef<number | null>(null);
  const resumeSequenceRef = useRef(0);
  const startRef = useRef<() => Promise<void>>(async () => undefined);
  const suspendedRef = useRef(false);
  const phaseRef = useRef<VoicePhase>('idle');
  const generationRef = useRef(0);
  // Guards async post-await state writes (transcription resolving AFTER the
  // component unmounts) so we don't setState on a dead tree or fire the
  // consumer callback at a torn-down composer.
  const mountedRef = useRef(true);
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
      if (!mountedRef.current) return;
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
    async (
      result: AudioCaptureResult,
      generation: number,
      workspaceId: string | undefined,
    ): Promise<void> => {
      if (generation !== generationRef.current) return;
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
          ...(workspaceId ? { workspaceId } : {}),
          audioBase64: result.pcm16Base64,
          mimeType: result.mimeType,
        });
        // The transcribe round-trip may resolve after unmount — don't deliver
        // the transcript to a torn-down composer or setState on a dead tree.
        if (!mountedRef.current || generation !== generationRef.current) return;
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

  const markUtteranceStart = useCallback((): void => {
    handleRef.current?.markUtteranceStart?.();
  }, []);

  const cancel = useCallback((): void => {
    generationRef.current += 1;
    startingGenerationRef.current = null;
    resumeSequenceRef.current += 1;
    resumeAttemptRef.current = null;
    setStarting(false);
    suspendedRef.current = false;
    handleRef.current?.cancel();
    handleRef.current = null;
    if (errorTimerRef.current !== undefined) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = undefined;
    if (!mountedRef.current) return;
    setErrorReason(null);
    setPhase('idle');
  }, [setPhase]);

  const suspend = useCallback((): void => {
    if (phaseRef.current === 'transcribing' || phaseRef.current === 'error') return;
    suspendedRef.current = true;
    resumeSequenceRef.current += 1;
    if (resumeAttemptRef.current !== null) {
      resumeAttemptRef.current = null;
      setStarting(false);
    }
    const handle = handleRef.current;
    if (handle && (!handle.suspend || !handle.resume)) {
      cancel();
      return;
    }
    handle?.suspend?.();
    if (handle || startingGenerationRef.current !== null) {
      setPhase('paused');
    }
  }, [cancel, setPhase]);

  const resume = useCallback(async (): Promise<void> => {
    if (phaseRef.current === 'transcribing' || phaseRef.current === 'error') return;
    suspendedRef.current = false;
    const handle = handleRef.current;
    if (handle) {
      const captureGeneration = generationRef.current;
      const attempt = resumeSequenceRef.current + 1;
      resumeSequenceRef.current = attempt;
      resumeAttemptRef.current = attempt;
      setStarting(true);
      try {
        await handle.resume?.();
        if (
          !mountedRef.current
          || suspendedRef.current
          || handleRef.current !== handle
          || resumeAttemptRef.current !== attempt
          || resumeSequenceRef.current !== attempt
          || generationRef.current !== captureGeneration
        ) return;
        setPhase('recording');
      } catch (error) {
        if (
          mountedRef.current
          && !suspendedRef.current
          && resumeAttemptRef.current === attempt
          && resumeSequenceRef.current === attempt
          && generationRef.current === captureGeneration
        ) {
          handle.cancel();
          handleRef.current = null;
          fail(error instanceof Error ? error.message : 'could not resume audio capture');
        }
      } finally {
        if (resumeAttemptRef.current === attempt) {
          resumeAttemptRef.current = null;
          if (mountedRef.current) setStarting(false);
        }
      }
      return;
    }
    if (startingGenerationRef.current !== null) {
      setPhase('idle');
      return;
    }
    setPhase('idle');
    await startRef.current();
  }, [fail, setPhase]);

  const start = useCallback(async (): Promise<void> => {
    if (
      phaseRef.current !== 'idle'
      || handleRef.current
      || startingGenerationRef.current !== null
    ) return;
    const audio = getPlatform().audioCapture;
    if (!audio?.isSupported()) {
      fail('mic unavailable');
      return;
    }
    let pendingGeneration: number | null = null;
    try {
      const generation = generationRef.current + 1;
      pendingGeneration = generation;
      generationRef.current = generation;
      startingGenerationRef.current = generation;
      const workspaceId = opts.workspaceId;
      setStarting(true);
      const handle = await audio.start({
        onResult: (result) => {
          handleRef.current = null;
          suspendedRef.current = false;
          void finalize(result, generation, workspaceId);
        },
        onError: (message) => {
          handleRef.current = null;
          suspendedRef.current = false;
          fail(message);
        },
        ...(onAnalyserRef.current ? { onAnalyser: onAnalyserRef.current } : {}),
      });
      if (!mountedRef.current || generation !== generationRef.current) {
        handle.cancel();
        return;
      }
      handleRef.current = handle;
      if (suspendedRef.current) {
        if (handle.suspend && handle.resume) {
          handle.suspend();
          setPhase('paused');
        } else {
          handle.cancel();
          handleRef.current = null;
          setPhase('idle');
        }
      } else {
        setPhase('recording');
      }
    } catch (e) {
      if (pendingGeneration !== generationRef.current) return;
      fail(e instanceof Error ? e.message : 'mic unavailable');
    } finally {
      if (startingGenerationRef.current === pendingGeneration) {
        startingGenerationRef.current = null;
        if (mountedRef.current) setStarting(false);
      }
    }
  }, [fail, finalize, opts.workspaceId, setPhase]);

  const toggle = useCallback((): void => {
    if (phaseRef.current === 'recording') stop();
    else void start();
  }, [start, stop]);
  startRef.current = start;

  // Tear down the mic + cancel the pending error-reset timer on unmount, and
  // mark unmounted so an in-flight transcription's post-await writes bail.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      startingGenerationRef.current = null;
      resumeSequenceRef.current += 1;
      resumeAttemptRef.current = null;
      handleRef.current?.cancel();
      handleRef.current = null;
      if (errorTimerRef.current !== undefined) clearTimeout(errorTimerRef.current);
    };
  }, []);

  return {
    phase,
    starting,
    errorReason,
    toggle,
    start: () => void start(),
    stop,
    suspend,
    resume,
    cancel,
    markUtteranceStart,
  };
}
