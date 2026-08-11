import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { chatStore } from './chatStore.js';
import {
  SpeechPlaybackQueue,
  type SpeechPlaybackKind,
  type SpeechPlaybackPhase,
} from './speech-playback-queue.js';
import {
  IncrementalSpeechSegmenter,
  type SpeechLanguage,
} from './streaming-speech.js';
import { toVoiceConversationText } from './speech.js';
import { api } from './transport.js';

export interface UseStreamingVoiceMode {
  readonly enabled: boolean;
  readonly phase: SpeechPlaybackPhase;
  readonly currentKind: SpeechPlaybackKind | null;
  readonly errorReason: string | null;
  /** Monotonic count of runner turns that reached completion while enabled. */
  readonly completedTurnCount: number;
  readonly completedTurnError: string | null;
  readonly toggle: () => void;
  readonly enable: () => void;
  readonly disable: () => void;
  readonly speakCue: (text: string, language: SpeechLanguage) => void;
  readonly prewarmCue: (text: string, language: SpeechLanguage) => Promise<void>;
  readonly cancelPendingCues: () => void;
  /** Stop current playback and suppress every later chunk from that turn. */
  readonly interruptCurrentTurn: () => string | null;
}

export interface StreamingVoiceModeOptions {
  readonly requireSynthesizer?: boolean;
  readonly onAnalyser?: (analyser: unknown | null) => void;
  readonly onAssistantSpeechQueued?: () => void;
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
  const onAssistantSpeechQueuedRef = useRef(options.onAssistantSpeechQueued);
  onAssistantSpeechQueuedRef.current = options.onAssistantSpeechQueued;
  const queue = useMemo(
    () => new SpeechPlaybackQueue(workspaceId, {
      requireSynthesizer: options.requireSynthesizer,
      onAnalyser: (analyser) => onAnalyserRef.current?.(analyser),
      prepareText: toVoiceConversationText,
    }),
    [options.requireSynthesizer, workspaceId],
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const segmenterRef = useRef(new IncrementalSpeechSegmenter());
  const turnIdRef = useRef<string | null>(null);
  const receivedChunkRef = useRef(false);
  const suppressedTurnIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) {
      queue.cancel();
      queue.clearPreparedCues();
      segmenterRef.current.reset();
      turnIdRef.current = null;
      receivedChunkRef.current = false;
      suppressedTurnIdsRef.current.clear();
      return;
    }

    const enqueueAssistant = (chunks: ReadonlyArray<string>): void => {
      if (chunks.length > 0) onAssistantSpeechQueuedRef.current?.();
      for (const chunk of chunks) queue.enqueue(chunk);
    };
    const offStarted = api().subscribe('runner.turn.started', (payload) => {
      if (
        payload.workspaceId !== workspaceId
        || payload.visibility === 'background'
        || chatStore.isHidden(payload.turnId)
      ) return;
      if (turnIdRef.current !== null && turnIdRef.current !== payload.turnId) queue.cancel();
      segmenterRef.current.reset();
      turnIdRef.current = payload.turnId;
      receivedChunkRef.current = false;
    });
    const offEvent = api().subscribe('runner.event', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      const event: MoxxyEvent = payload.event;
      if (chatStore.isHidden(event.turnId)) return;
      if (suppressedTurnIdsRef.current.has(event.turnId)) return;
      if (event.type === 'assistant_chunk') {
        if (turnIdRef.current === null) turnIdRef.current = event.turnId;
        if (event.turnId !== turnIdRef.current) return;
        receivedChunkRef.current = true;
        enqueueAssistant(segmenterRef.current.push(event.delta));
        return;
      }
      if (event.type === 'assistant_message') {
        if (turnIdRef.current === null) turnIdRef.current = event.turnId;
        if (event.turnId !== turnIdRef.current) return;
        if (receivedChunkRef.current) {
          enqueueAssistant(segmenterRef.current.flush());
        } else {
          enqueueAssistant([
            ...segmenterRef.current.push(event.content),
            ...segmenterRef.current.flush(),
          ]);
        }
        receivedChunkRef.current = false;
      }
    });
    const offComplete = api().subscribe('runner.turn.complete', (payload) => {
      if (payload.workspaceId !== workspaceId) return;
      if (suppressedTurnIdsRef.current.delete(payload.turnId)) {
        if (payload.turnId === turnIdRef.current) {
          segmenterRef.current.reset();
          turnIdRef.current = null;
          receivedChunkRef.current = false;
        }
        return;
      }
      if (payload.turnId !== turnIdRef.current) return;
      enqueueAssistant(segmenterRef.current.flush());
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
      queue.clearPreparedCues();
      segmenterRef.current.reset();
      turnIdRef.current = null;
      receivedChunkRef.current = false;
      suppressedTurnIdsRef.current.clear();
    };
  }, [enabled, queue, workspaceId]);

  const toggle = useCallback(() => setEnabled((value) => !value), []);
  const enable = useCallback(() => setEnabled(true), []);
  const disable = useCallback(() => setEnabled(false), []);
  const speakCue = useCallback(
    (text: string, language: SpeechLanguage) => queue.enqueueCue(text, language),
    [queue],
  );
  const prewarmCue = useCallback(
    (text: string, language: SpeechLanguage) => queue.prewarmCue(text, language),
    [queue],
  );
  const cancelPendingCues = useCallback(() => queue.cancelPendingCues(), [queue]);
  const interruptCurrentTurn = useCallback((): string | null => {
    const turnId = turnIdRef.current;
    if (turnId !== null) suppressedTurnIdsRef.current.add(turnId);
    segmenterRef.current.reset();
    turnIdRef.current = null;
    receivedChunkRef.current = false;
    queue.cancel();
    return turnId;
  }, [queue]);
  return {
    enabled,
    phase: snapshot.phase,
    currentKind: snapshot.currentKind,
    errorReason: snapshot.errorReason,
    completedTurnCount,
    completedTurnError,
    toggle,
    enable,
    disable,
    speakCue,
    prewarmCue,
    cancelPendingCues,
    interruptCurrentTurn,
  };
}
