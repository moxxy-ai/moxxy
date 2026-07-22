import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from './chatStore.js';
import {
  SpeechPlaybackQueue,
  type SpeechPlaybackPhase,
} from './speech-playback-queue.js';
import { IncrementalSpeechSegmenter } from './streaming-speech.js';
import { api } from './transport.js';

export interface UseStreamingVoiceMode {
  readonly enabled: boolean;
  readonly phase: SpeechPlaybackPhase;
  readonly errorReason: string | null;
  /** Monotonic count of runner turns that reached completion while enabled. */
  readonly completedTurnCount: number;
  readonly completedTurnError: string | null;
  readonly toggle: () => void;
  readonly enable: () => void;
  readonly disable: () => void;
}

export interface StreamingVoiceModeOptions {
  readonly requireSynthesizer?: boolean;
  readonly onAnalyser?: (analyser: unknown | null) => void;
}

/** Speaks assistant deltas sentence-by-sentence while a desktop turn streams. */
export function useStreamingVoiceMode(
  workspaceId: string,
  options: StreamingVoiceModeOptions = {},
): UseStreamingVoiceMode {
  const [enabled, setEnabled] = useState(false);
  const [completedTurnCount, setCompletedTurnCount] = useState(0);
  const [completedTurnError, setCompletedTurnError] = useState<string | null>(null);
  const onAnalyserRef = useRef(options.onAnalyser);
  onAnalyserRef.current = options.onAnalyser;
  const queue = useMemo(
    () => new SpeechPlaybackQueue(workspaceId, {
      requireSynthesizer: options.requireSynthesizer,
      onAnalyser: (analyser) => onAnalyserRef.current?.(analyser),
    }),
    [options.requireSynthesizer, workspaceId],
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const segmenterRef = useRef(new IncrementalSpeechSegmenter());
  const turnIdRef = useRef<string | null>(null);
  const receivedChunkRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      queue.cancel();
      segmenterRef.current.reset();
      turnIdRef.current = null;
      receivedChunkRef.current = false;
      return;
    }

    const enqueue = (chunks: ReadonlyArray<string>): void => {
      for (const chunk of chunks) queue.enqueue(chunk);
    };
    const offStarted = api().subscribe('runner.turn.started', (payload) => {
      if (payload.workspaceId !== workspaceId || chatStore.isHidden(payload.turnId)) return;
      queue.cancel();
      segmenterRef.current.reset();
      turnIdRef.current = payload.turnId;
      receivedChunkRef.current = false;
    });
    const offEvent = api().subscribe('runner.event', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      const event: MoxxyEvent = payload.event;
      if (chatStore.isHidden(event.turnId)) return;
      if (event.type === 'assistant_chunk') {
        if (turnIdRef.current === null) turnIdRef.current = event.turnId;
        if (event.turnId !== turnIdRef.current) return;
        receivedChunkRef.current = true;
        enqueue(segmenterRef.current.push(event.delta));
        return;
      }
      if (event.type === 'assistant_message') {
        if (turnIdRef.current === null) turnIdRef.current = event.turnId;
        if (event.turnId !== turnIdRef.current) return;
        if (receivedChunkRef.current) {
          enqueue(segmenterRef.current.flush());
        } else {
          enqueue([
            ...segmenterRef.current.push(event.content),
            ...segmenterRef.current.flush(),
          ]);
        }
        receivedChunkRef.current = false;
      }
    });
    const offComplete = api().subscribe('runner.turn.complete', (payload) => {
      if (payload.workspaceId !== workspaceId || payload.turnId !== turnIdRef.current) return;
      enqueue(segmenterRef.current.flush());
      turnIdRef.current = null;
      receivedChunkRef.current = false;
      setCompletedTurnError(payload.error);
      setCompletedTurnCount((count) => count + 1);
    });

    return () => {
      offStarted();
      offEvent();
      offComplete();
      queue.cancel();
      segmenterRef.current.reset();
      turnIdRef.current = null;
      receivedChunkRef.current = false;
    };
  }, [enabled, queue, workspaceId]);

  const toggle = useCallback(() => setEnabled((value) => !value), []);
  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => setEnabled(false), []);
  return {
    enabled,
    phase: snapshot.phase,
    errorReason: snapshot.errorReason,
    completedTurnCount,
    completedTurnError,
    toggle,
    enable,
    disable,
  };
}
