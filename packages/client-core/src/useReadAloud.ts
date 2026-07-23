import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  SpeechPlaybackQueue,
  type SpeechPlaybackPhase,
} from './speech-playback-queue.js';
import { IncrementalSpeechSegmenter } from './streaming-speech.js';

export interface UseReadAloud {
  readonly phase: SpeechPlaybackPhase;
  readonly active: boolean;
  readonly errorReason: string | null;
  readonly toggle: () => void;
  readonly stop: () => void;
}

/** Manual read-aloud orchestration shared by every presentation component. */
export function useReadAloud(text: string, workspaceId?: string): UseReadAloud {
  const queue = useMemo(() => new SpeechPlaybackQueue(workspaceId), [workspaceId]);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  useEffect(() => () => queue.cancel(), [queue]);

  const stop = useCallback(() => queue.cancel(), [queue]);
  const toggle = useCallback((): void => {
    if (snapshot.phase === 'speaking' || snapshot.phase === 'synthesizing') {
      queue.cancel();
      return;
    }
    const segmenter = new IncrementalSpeechSegmenter();
    for (const chunk of [...segmenter.push(text), ...segmenter.flush()]) {
      queue.enqueue(chunk);
    }
  }, [queue, snapshot.phase, text]);

  return {
    phase: snapshot.phase,
    active: snapshot.phase === 'speaking' || snapshot.phase === 'synthesizing',
    errorReason: snapshot.errorReason,
    toggle,
    stop,
  };
}
