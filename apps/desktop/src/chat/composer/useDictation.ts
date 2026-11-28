import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useVoiceRecorder, type VoicePhase } from '@moxxy/client-core';

type Feedback = 'setup' | 'unavailable' | null;

export interface Dictation {
  readonly phase: VoicePhase;
  readonly notice: string | null;
  readonly needsSetup: boolean;
  readonly dismissSetup: () => void;
  readonly press: () => void;
}

/** One-shot dictation for the composer: record, transcribe, hand the text back. */
export function useDictation({
  workspaceId,
  ready,
  suspended,
  onTranscript,
}: {
  readonly workspaceId: string;
  readonly ready: boolean;
  readonly suspended: boolean;
  readonly onTranscript: (text: string) => void;
}): Dictation {
  const { phase, errorReason, start, stop, cancel } = useVoiceRecorder({ workspaceId, onTranscript });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const pending = useRef<symbol | null>(null);
  const dismissSetup = useCallback(() => setFeedback(null), []);

  useEffect(() => {
    setFeedback(null);
    // A late reply must not start the mic after leaving this chat or entering Voice Mode.
    return () => { pending.current = null; };
  }, [ready, suspended, workspaceId]);

  const busy = phase === 'recording' || phase === 'transcribing';
  useEffect(() => {
    if (suspended && busy) cancel();
  }, [suspended, busy, cancel]);

  const press = useCallback(async () => {
    if (suspended || phase === 'transcribing') return;
    if (phase === 'recording') {
      stop();
      return;
    }
    if (!ready) {
      setFeedback('unavailable');
      return;
    }
    if (pending.current !== null) return;
    const request = Symbol();
    pending.current = request;
    setFeedback(null);
    try {
      const available = await api().invoke('session.hasTranscriber');
      if (pending.current !== request) return;
      if (available) start();
      else setFeedback('setup');
    } catch {
      if (pending.current === request) setFeedback('unavailable');
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, [ready, suspended, phase, start, stop]);

  return {
    phase,
    notice: errorReason ?? (feedback === 'unavailable' ? 'Couldn’t check dictation. Try again in a moment.' : null),
    needsSetup: feedback === 'setup',
    dismissSetup,
    press,
  };
}
