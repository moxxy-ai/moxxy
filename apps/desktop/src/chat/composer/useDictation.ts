import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useVoiceRecorder, type VoicePhase } from '@moxxy/client-core';

const NO_TRANSCRIBER = 'No transcriber configured on the runner.';
const NOTICE_MS = 2500;

export interface Dictation {
  readonly phase: VoicePhase;
  /** Why the last press did nothing, or why a recording failed. */
  readonly notice: string | null;
  /** Start a recording, or stop the one in flight. */
  readonly press: () => void;
}

/**
 * One-shot dictation for the composer: record, transcribe, hand the text back.
 *
 * `suspended` is set while a voice conversation owns the microphone. A
 * dictation in flight lets go then, because two capture leases on one device
 * is how a recording ends up never resolving.
 */
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
  const voice = useVoiceRecorder({ workspaceId, onTranscript });
  const [hasTranscriber, setHasTranscriber] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void api()
      .invoke('session.hasTranscriber')
      .then((has) => {
        if (!cancelled) setHasTranscriber(has === true);
      })
      .catch(() => {
        if (!cancelled) setHasTranscriber(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const { cancel, toggle, phase } = voice;
  const busy = phase === 'recording' || phase === 'transcribing';
  useEffect(() => {
    if (suspended && busy) cancel();
  }, [suspended, busy, cancel]);

  useEffect(
    () => () => {
      if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const press = useCallback(() => {
    if (phase !== 'recording' && !hasTranscriber) {
      setNotice(NO_TRANSCRIBER);
      if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
      return;
    }
    toggle();
  }, [hasTranscriber, phase, toggle]);

  return { phase, notice: voice.errorReason ?? notice, press };
}
