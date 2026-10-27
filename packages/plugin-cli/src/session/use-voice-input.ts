import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientSession as Session } from '@moxxy/sdk';
import { getInstallHint, MOXXY_PCM16_24KHZ_MIME, type RequirementCheck, type Transcriber } from '@moxxy/sdk';
import type { ExternalInsert } from '../components/prompt/external-insert.js';
import {
  startVoiceRecording,
  checkVoiceCaptureAvailable,
  unavailableVoiceCaptureCheck,
  VOICE_CAPTURE_RUNTIME,
  type ActiveVoiceRecording,
  type StartVoiceRecordingOptions,
} from '../voice-input.js';

export interface UseVoiceInputOptions {
  readonly session: Session;
  readonly setSystemNotice: (notice: string | null) => void;
  readonly startRecording?: (opts?: StartVoiceRecordingOptions) => Promise<ActiveVoiceRecording>;
  readonly checkCaptureAvailable?: () => Promise<RequirementCheck>;
}

export type VoicePhase = 'idle' | 'recording' | 'transcribing';

export interface VoiceInputState {
  readonly externalInsert?: ExternalInsert;
  readonly ready: boolean;
  /**
   * Current recording phase. Surfaced so the prompt area can render a
   * visible badge ('● REC' / 'TRANSCRIBING') without having to mirror
   * the internal `phaseRef`.
   */
  readonly phase: VoicePhase;
  readonly toggleVoiceInput: () => void;
}

export function useVoiceInput(opts: UseVoiceInputOptions): VoiceInputState {
  const { session, setSystemNotice } = opts;
  const startRecording = opts.startRecording ?? startVoiceRecording;
  const checkCaptureAvailable = opts.checkCaptureAvailable ?? checkVoiceCaptureAvailable;
  const phaseRef = useRef<VoicePhase>('idle');
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const setVoicePhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const recordingRef = useRef<ActiveVoiceRecording | null>(null);
  const insertIdRef = useRef(0);
  const [externalInsert, setExternalInsert] = useState<ExternalInsert | undefined>();
  const [captureReadiness, setCaptureReadiness] = useState<RequirementCheck>(() =>
    unavailableVoiceCaptureCheck(),
  );
  const readiness = combineVoiceInputReadiness(checkVoiceInputReady(session), captureReadiness);
  const ready = readiness.ready;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await checkCaptureAvailable();
        if (!cancelled) setCaptureReadiness(next);
      } catch {
        if (!cancelled) setCaptureReadiness(unavailableVoiceCaptureCheck());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkCaptureAvailable]);

  // Unmount safety: if the TUI tears down (Ctrl+C exit, /new, process
  // teardown) mid-recording, stop the live recorder so the spawned ffmpeg
  // child is signalled to quit (and SIGKILLed by stopProcess's timer) and the
  // unbounded PCM buffer it's accumulating is released. Without this the child
  // keeps the microphone open and grows its in-memory capture forever.
  useEffect(() => {
    return () => {
      const recording = recordingRef.current;
      recordingRef.current = null;
      void recording?.stop().catch(() => {});
    };
  }, []);

  const toggleVoiceInput = useCallback(() => {
    void (async () => {
      if (phaseRef.current === 'transcribing') {
        setSystemNotice('voice: transcription is still running');
        return;
      }

      if (phaseRef.current === 'recording') {
        const recording = recordingRef.current;
        recordingRef.current = null;
        setVoicePhase('transcribing');
        setSystemNotice('voice: transcribing...');
        try {
          if (!recording) throw new Error('voice recorder is not running');
          const pcm = await recording.stop();
          const transcriber = resolveVoiceTranscriber(session);
          const result = await transcriber.transcribe(pcm, {
            mimeType: MOXXY_PCM16_24KHZ_MIME,
          });
          const text = result.text.trim();
          if (!text) {
            setSystemNotice('voice: empty transcript');
            return;
          }
          const id = insertIdRef.current + 1;
          insertIdRef.current = id;
          setExternalInsert({ id, text });
          setSystemNotice('voice: transcript inserted');
        } catch (err) {
          setSystemNotice(formatVoiceError(err));
        } finally {
          setVoicePhase('idle');
        }
        return;
      }

      try {
        const readiness = combineVoiceInputReadiness(
          checkVoiceInputReady(session),
          captureReadiness,
        );
        if (!readiness.ready) {
          setSystemNotice(formatVoiceReadinessNotice(readiness));
          return;
        }
        recordingRef.current = await startRecording();
        setVoicePhase('recording');
        setSystemNotice('voice: recording, press Ctrl+R to stop');
      } catch (err) {
        recordingRef.current = null;
        setVoicePhase('idle');
        setSystemNotice(formatVoiceError(err));
      }
    })();
  }, [captureReadiness, session, setSystemNotice, setVoicePhase, startRecording]);

  return { externalInsert, ready, phase, toggleVoiceInput };
}

/** Shown when no speech-to-text backend is active in this session. */
const NO_TRANSCRIBER =
  'no transcription is set up. Save OPENAI_API_KEY with /vault set, or set plugins.transcriber.default, then restart';
const NO_TRANSCRIBER_RUNTIME = 'voice:transcriber';

/** Voice input works with whichever transcriber the session has active. */
export function checkVoiceInputReady(session: Session): RequirementCheck {
  if (session.transcribers.getActiveName()) return { ready: true, issues: [] };
  return {
    ready: false,
    issues: [
      {
        requirement: { kind: 'runtime', name: NO_TRANSCRIBER_RUNTIME, state: 'ready' },
        code: 'not_ready',
        message: NO_TRANSCRIBER,
      },
    ],
  };
}

export function combineVoiceInputReadiness(
  transcriberCheck: RequirementCheck,
  captureCheck: RequirementCheck,
): RequirementCheck {
  return {
    ready: transcriberCheck.ready && captureCheck.ready,
    issues: [...transcriberCheck.issues, ...captureCheck.issues],
  };
}

export function resolveVoiceTranscriber(session: Session): Transcriber {
  const transcriber = session.transcribers.tryGetActive();
  if (!transcriber) throw new Error(NO_TRANSCRIBER);
  return transcriber;
}

export function formatVoiceReadinessNotice(check: RequirementCheck): string {
  const issue = check.issues.find((i) => !i.requirement.optional) ?? check.issues[0];
  if (!issue) return 'voice: unavailable';
  if (issue.requirement.kind === 'runtime' && issue.requirement.name === VOICE_CAPTURE_RUNTIME) {
    const install = getInstallHint('ffmpeg');
    return `voice: ffmpeg is required for voice input\nInstall via ${install.manager}:  ${install.command}`;
  }
  return `voice: ${issue.hint ?? issue.message}`;
}

function formatVoiceError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `voice: ${message || 'failed'}`;
}
