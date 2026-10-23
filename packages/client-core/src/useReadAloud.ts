import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  SpeechPlaybackQueue,
  type SpeechPlaybackPhase,
} from './speech-playback-queue.js';
import { IncrementalSpeechSegmenter } from './streaming-speech.js';
import { splitForReadAloud } from './read-aloud-parts.js';
import { api } from './transport.js';

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

  // Set while the host says how to send the message, so a second click then
  // does not start the message twice.
  const planning = useRef(false);

  const stop = useCallback(() => queue.cancel(), [queue]);
  const toggle = useCallback((): void => {
    if (snapshot.phase === 'speaking' || snapshot.phase === 'synthesizing') {
      queue.cancel();
      return;
    }
    if (planning.current) return;
    planning.current = true;
    void readAloudPlan(workspaceId)
      .then((plan) => {
        if (plan) {
          // Gemini TTS: the whole message in as few requests as it allows,
          // each kept on disk so hearing it again costs nothing.
          for (const part of splitForReadAloud(text, plan.partChars)) {
            queue.enqueue(part, undefined, { cache: true });
          }
          return;
        }
        const segmenter = new IncrementalSpeechSegmenter();
        for (const chunk of [...segmenter.push(text), ...segmenter.flush()]) {
          queue.enqueue(chunk);
        }
      })
      .finally(() => {
        planning.current = false;
      });
  }, [queue, snapshot.phase, text, workspaceId]);

  return {
    phase: snapshot.phase,
    active: snapshot.phase === 'speaking' || snapshot.phase === 'synthesizing',
    errorReason: snapshot.errorReason,
    toggle,
    stop,
  };
}

/** How the host wants this message sent; sentence by sentence when it cannot say. */
async function readAloudPlan(workspaceId: string | undefined): Promise<{ partChars: number } | null> {
  try {
    return await api().invoke('session.readAloudPlan', workspaceId ? { workspaceId } : undefined);
  } catch {
    return null;
  }
}
